const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// ⚙️ CONFIG
const API_KEY = '7VA33R1WLZPM4Q642HNQ3M62EKFMKSF3';
const SHOP_URL = 'https://www.exalto-professional-shop.com';

// Config axios
const api = axios.create({
  baseURL: `${SHOP_URL}/api`,
  auth: { username: API_KEY, password: '' },
  params: { output_format: 'JSON' }
});

// Route que Chatbase va appeler
app.get('/produits/all', async (req, res) => {
  try {
    const recherche = req.query.nom?.toLowerCase() || '';

    // Récupère les produits
    const prodRes = await api.get('/products', {
      params: {
        output_format: 'JSON',
        display: '[id,name,price,description_short,description,active,id_default_image,link_rewrite,id_category_default]',
        filter: { active: 1 }
      }
    });

    let products = prodRes.data.products;

    // Filtre par nom OU description si recherche
    if (recherche) {
      products = products.filter(p =>
        p.name[0]?.value?.toLowerCase().includes(recherche) ||
        p.description_short[0]?.value?.toLowerCase().includes(recherche) ||
        p.description[0]?.value?.toLowerCase().includes(recherche)
      );
    }

    // Récupère le stock pour chaque produit
    const results = await Promise.all(products.map(async (product) => {
      const id = product.id;
      const nom = product.name[0]?.value || '';
      const prix = parseFloat(product.price).toFixed(2);
      const slug = product.link_rewrite[0]?.value || '';
      const description =
        product.description_short[0]?.value?.replace(/<[^>]*>/g, '').trim() ||
        product.description[0]?.value?.replace(/<[^>]*>/g, '').trim() || '';
      const imageUrl = `${SHOP_URL}/${product.id_default_image}-large_default/${id}.jpg`;
      const lien = `${SHOP_URL}/fr/nos-modeles/${id}-${slug}.html`;

      // Stock
      const stockRes = await api.get('/stock_availables', {
        params: {
          output_format: 'JSON',
          display: '[quantity]',
          filter: { id_product: id }
        }
      });
      const qty = parseInt(stockRes.data.stock_availables?.[0]?.quantity) || 0;

      return {
        nom,
        prix: `${prix} €`,
        stock: qty > 0 ? 'En stock' : 'Rupture de stock',
        description,
        image: imageUrl,
        lien
      };
    }));

    res.json({ produits: results });

  } catch (err) {
    console.error('Erreur :', err.message);
    res.status(500).json({ erreur: 'Erreur serveur' });
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
        .card-body h3 { font-size: 14px; color: #333; margin-bottom: 8px; }
        .prix { font-weight: bold; color: #222; font-size: 16px; }
        .stock { display: inline-block; margin-top: 8px; padding: 3px 10px; border-radius: 20px; font-size: 12px; font-weight: bold; }
        .stock.dispo { background: #e6f4ea; color: #2e7d32; }
        .stock.rupture { background: #fce8e6; color: #c62828; }
        .btn { display: block; margin-top: 12px; text-align: center; padding: 8px; background: #333; color: white; border-radius: 8px; text-decoration: none; font-size: 13px; }
        .btn:hover { background: #555; }
        #count { text-align: center; color: #888; margin-bottom: 20px; font-size: 14px; }
      </style>
    </head>
    <body>
      <h1>🗂️ Catalogue Exalto</h1>
      <input type="text" id="search" placeholder="Rechercher un produit...">
      <p id="count"></p>
      <div class="grid" id="grid"></div>

      <script>
        let allProducts = [];

        async function loadProducts(nom = '') {
          const url = nom ? '/produits?nom=' + encodeURIComponent(nom) : '/produits';
          const res = await fetch(url);
          const data = await res.json();
          allProducts = data.produits;
          render(allProducts);
        }

        function render(products) {
          const grid = document.getElementById('grid');
          const count = document.getElementById('count');
          count.textContent = products.length + ' produit(s) trouvé(s)';
          grid.innerHTML = products.map(p => \`
            <div class="card">
              <img src="\${p.image}" alt="\${p.nom}" onerror="this.src='https://via.placeholder.com/220x200?text=Image+indisponible'">
              <div class="card-body">
                <h3>\${p.nom}</h3>
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

app.listen(3000, () => {
  console.log('✅ Serveur démarré sur http://localhost:3000');
  console.log('📦 Route disponible : http://localhost:3000/produits');
});