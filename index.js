const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// ⚙️ CONFIG
const API_KEY = '7VA33R1WLZPM4Q642HNQ3M62EKFMKSF3';
const SHOP_URL = 'https://www.exalto-professional-shop.com';
const CATEGORIES_AUTORISEES = [4, 5, 6, 7, 11, 12, 13];
const NOMS_CATEGORIES = {
  4: 'Têtes malléables femme',
  5: 'Têtes malléables homme',
  6: 'Têtes chignon',
  7: 'Modèles',
  11: 'Trépieds',
  12: 'Étau',
  13: 'Mèches & bustes'
};
const CATEGORIE_MAP = {
  'femme': [4],
  'homme': [5],
  'chignon': [6],
  'modeles': [7],
  'trepied': [11],
  'etau': [12],
  'meches': [13],
  'bustes': [13]
};
const STOP_WORDS = [
  'une', 'des', 'les', 'pour', 'avec', 'dans', 'sur', 'par', 'que',
  'qui', 'est', 'pas', 'plus', 'tres', 'bien', 'avoir', 'etre',
  'tete', 'tetes', 'malleable', 'malleables', 'coiffer', 'coiffure',
  'cherche', 'veux', 'voudrais', 'aimerais', 'besoin', 'trouver',
  'vous', 'nous', 'votre', 'notre', 'mon', 'ton', 'son',
  'aussi', 'comme', 'faire', 'chez', 'exalto', 'professionnelle',
  'speciale', 'special'
];

const api = axios.create({
  baseURL: `${SHOP_URL}/api`,
  auth: { username: API_KEY, password: '' }
});

// 🗄️ CACHE
let cache = [];
let lastUpdate = null;
const CACHE_DURATION = 60 * 60 * 1000; // 1 heure

// Normalise le texte pour la recherche
const normalise = str => str
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase();

// Récupère tous les noms de catégories
async function getAllCategories() {
  const res = await api.get('/categories', {
    params: { output_format: 'JSON', display: '[id,name]' }
  });
  const map = {};
  for (const cat of res.data.categories) {
    map[Number(cat.id)] = cat.name?.[0]?.value || '';
  }
  return map;
}

// Récupère les catégories associées d'un produit
async function getCategoriesAssociees(productId, allCategories) {
  try {
    const res = await api.get(`/products/${productId}`, {
      params: { output_format: 'JSON', display: '[associations]' }
    });
    const cats = res.data.product?.associations?.categories || [];
    return cats.map(c => allCategories[Number(c.id)]).filter(Boolean);
  } catch {
    return [];
  }
}

// Charge tous les produits et les met en cache
async function chargerCache() {
  console.log('🔄 Chargement du cache produits...');

  const allCategories = await getAllCategories();

  const prodRes = await api.get('/products', {
    params: {
      output_format: 'JSON',
      display: '[id,name,price,description_short,description,active,id_default_image,link_rewrite,id_category_default]',
      'filter[active]': 1
    }
  });

  let products = prodRes.data.products;

  // Filtre par catégories autorisées
  products = products.filter(p =>
    CATEGORIES_AUTORISEES.includes(Number(p.id_category_default))
  );

  console.log(`📦 ${products.length} produits à charger...`);

  // Charge chaque produit avec ses catégories associées et son stock
  const results = await Promise.all(products.map(async (product) => {
    const id = product.id;
    const nom = product.name?.[0]?.value || '';
    const prix = parseFloat(product.price || 0).toFixed(2);
    const slug = product.link_rewrite?.[0]?.value || '';
    const descriptionCourte = product.description_short?.[0]?.value?.replace(/<[^>]*>/g, '').trim() || '';
    const descriptionLongue = product.description?.[0]?.value?.replace(/<[^>]*>/g, '').trim() || '';
    const description = descriptionCourte || descriptionLongue;
    const image = `${SHOP_URL}/${product.id_default_image}-large_default/${id}.jpg`;
    const lien = `${SHOP_URL}/fr/nos-modeles/${id}-${slug}.html`;
    const categorieNom = NOMS_CATEGORIES[Number(product.id_category_default)] || 'Autre';

    // Catégories associées
    const catsAssociees = await getCategoriesAssociees(id, allCategories);

    // Stock
    const stockRes = await api.get('/stock_availables', {
      params: {
        output_format: 'JSON',
        display: '[quantity]',
        'filter[id_product]': id
      }
    });
    const qty = parseInt(stockRes.data.stock_availables?.[0]?.quantity) || 0;

    // Texte complet pour la recherche
    const texteRecherche = normalise([
      nom,
      description,
      categorieNom,
      ...catsAssociees
    ].join(' '));

    return {
      nom,
      categorie: categorieNom,
      categories_associees: catsAssociees,
      prix: `${prix} €`,
      stock: qty > 0 ? 'En stock' : 'Rupture de stock',
      description,
      image,
      lien,
      texteRecherche // utilisé uniquement pour la recherche
    };
  }));

  cache = results;
  lastUpdate = Date.now();
  console.log(`✅ Cache chargé : ${cache.length} produits`);
}

// Vérifie si le cache doit être rafraîchi
async function getCache() {
  if (!lastUpdate || Date.now() - lastUpdate > CACHE_DURATION) {
    await chargerCache();
  }
  return cache;
}

// Route produits
app.get('/produits', async (req, res) => {
  try {
    const recherche = req.query.nom?.toLowerCase() || '';
    const categorie = req.query.categorie?.toLowerCase() || '';

    let produits = await getCache();

    // Filtre par catégorie si précisée
    if (categorie && CATEGORIE_MAP[categorie]) {
      const ids = CATEGORIE_MAP[categorie];
      produits = produits.filter(p =>
        ids.includes(Number(
          Object.keys(NOMS_CATEGORIES).find(k => NOMS_CATEGORIES[k] === p.categorie)
        ))
      );
    }

    // Filtre par mots-clés si recherche
    if (recherche) {
      const mots = normalise(recherche)
        .split(' ')
        .filter(m => m.length > 2 && !STOP_WORDS.includes(m));

      console.log('MOTS RECHERCHÉS:', mots);

      if (mots.length > 0) {
        produits = produits.filter(p =>
          mots.some(mot => p.texteRecherche.includes(mot))
        );
      }
    }

    console.log(`RÉSULTATS: ${produits.length} produits`);

    // On renvoie sans le texteRecherche
    res.json({
      produits: produits.map(({ texteRecherche, ...p }) => p)
    });

  } catch (err) {
    console.error('ERREUR:', err.message);
    res.status(500).json({ erreur: 'Erreur serveur' });
  }
});

// Route pour forcer le rafraîchissement du cache
app.get('/refresh', async (req, res) => {
  try {
    await chargerCache();
    res.json({ message: `Cache rafraîchi : ${cache.length} produits` });
  } catch (err) {
    res.status(500).json({ erreur: err.message });
  }
});

app.get('/', async (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="fr">
    <head>
      <meta charset="UTF-8">
      <title>Exalto - Catalogue</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Segoe UI', sans-serif; background: #f5f5f5; padding: 30px; }
        h1 { text-align: center; margin-bottom: 30px; color: #333; font-size: 28px; }
        #search { display: block; margin: 0 auto 30px; padding: 12px 20px; width: 400px; border: 2px solid #ddd; border-radius: 25px; font-size: 16px; outline: none; }
        #search:focus { border-color: #333; }
        .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 20px; }
        .card { background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08); transition: transform 0.2s; }
        .card:hover { transform: translateY(-4px); }
        .card img { width: 100%; height: 200px; object-fit: cover; }
        .card-body { padding: 15px; }
        .card-body h3 { font-size: 14px; color: #333; margin-bottom: 6px; }
        .categorie { font-size: 11px; color: #888; margin-bottom: 4px; text-transform: uppercase; }
        .tags { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px; }
        .tag { background: #f0f0f0; color: #555; font-size: 10px; padding: 2px 8px; border-radius: 10px; }
        .prix { font-weight: bold; color: #222; font-size: 16px; }
        .stock { display: inline-block; margin-top: 8px; padding: 3px 10px; border-radius: 20px; font-size: 12px; font-weight: bold; }
        .stock.dispo { background: #e6f4ea; color: #2e7d32; }
        .stock.rupture { background: #fce8e6; color: #c62828; }
        .btn { display: block; margin-top: 12px; text-align: center; padding: 8px; background: #333; color: white; border-radius: 8px; text-decoration: none; font-size: 13px; }
        .btn:hover { background: #555; }
        #count { text-align: center; color: #888; margin-bottom: 20px; font-size: 14px; }
        #status { text-align: center; color: #aaa; font-size: 12px; margin-bottom: 10px; }
      </style>
    </head>
    <body>
      <h1>🗂️ Catalogue Exalto</h1>
      <input type="text" id="search" placeholder="Rechercher un produit...">
      <p id="count"></p>
      <p id="status"></p>
      <div class="grid" id="grid"></div>

      <script>
        async function loadProducts(nom = '') {
          document.getElementById('status').textContent = 'Chargement...';
          const url = nom ? '/produits?nom=' + encodeURIComponent(nom) : '/produits';
          const res = await fetch(url);
          const data = await res.json();
          document.getElementById('status').textContent = '';
          render(data.produits || []);
        }

        function render(products) {
          const grid = document.getElementById('grid');
          const count = document.getElementById('count');
          count.textContent = products.length + ' produit(s) trouvé(s)';
          grid.innerHTML = products.map(p => \`
            <div class="card">
              <img src="\${p.image}" alt="\${p.nom}" onerror="this.src='https://via.placeholder.com/220x200?text=Image+indisponible'">
              <div class="card-body">
                <p class="categorie">\${p.categorie}</p>
                <h3>\${p.nom}</h3>
                <div class="tags">
                  \${(p.categories_associees || []).map(c => \`<span class="tag">\${c}</span>\`).join('')}
                </div>
                <div class="prix">\${p.prix}</div>
                <span class="stock \${p.stock === 'En stock' ? 'dispo' : 'rupture'}">\${p.stock}</span>
                <a class="btn" href="\${p.lien}" target="_blank">Voir le produit</a>
              </div>
            </div>
          \`).join('');
        }

        let timer;
        document.getElementById('search').addEventListener('input', (e) => {
          clearTimeout(timer);
          timer = setTimeout(() => loadProducts(e.target.value), 400);
        });

        loadProducts();
      </script>
    </body>
    </html>
  `);
});

// Démarre le serveur et charge le cache
app.listen(3000, async () => {
  console.log('✅ Serveur démarré sur http://localhost:3000');
  await chargerCache();
});