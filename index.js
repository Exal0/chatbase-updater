const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// CONFIG
const API_KEY = '7VA33R1WLZPM4Q642HNQ3M62EKFMKSF3';
const SHOP_URL = 'https://www.exalto-professional-shop.com';

// Config axios
const api = axios.create({
  baseURL: `${SHOP_URL}/api`,
  auth: { username: API_KEY, password: '' },
  params: { output_format: 'JSON' }
});

// Utilitaire pour nettoyer le HTML
function stripHtml(str = '') {
  return String(str).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

// Utilitaire pour lire les champs multilangues PrestaShop
function getLangValue(field) {
  if (!field) return '';
  if (Array.isArray(field)) return field[0]?.value || '';
  if (typeof field === 'object' && field.value) return field.value;
  if (typeof field === 'string') return field;
  return '';
}

// Normalisation texte : minuscule + suppression accents + trim
function normalizeText(str = '') {
  return String(str)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Découpe une recherche en mots
function splitSearchWords(str = '') {
  return normalizeText(str)
    .split(/\s+/)
    .filter(Boolean);
}

// Vérifie que tous les mots recherchés sont présents quelque part
function matchesAllWords(search, ...fields) {
  const words = splitSearchWords(search);
  if (!words.length) return true;

  const haystack = normalizeText(
    fields
      .flat()
      .filter(Boolean)
      .join(' ')
  );

  return words.every(word => haystack.includes(word));
}

// Route API
app.get('/produits', async (req, res) => {
  try {
    const rechercheNom = (req.query.nom || '').trim();
    const rechercheCategorie = (req.query.categorie || '').trim();
    const rechercheFeature = (req.query.feature || '').trim();

    // 1) Produits actifs avec associations
    const prodRes = await api.get('/products', {
      params: {
        output_format: 'JSON',
        display: 'full',
        'filter[active]': '[1]'
      }
    });

    let products = prodRes.data.products || [];

    // 2) Catégories
    const categoriesRes = await api.get('/categories', {
      params: {
        output_format: 'JSON',
        display: '[id,name]'
      }
    });

    const categoriesList = categoriesRes.data.categories || [];
    const categoriesMap = {};

    for (const cat of categoriesList) {
      categoriesMap[String(cat.id)] = getLangValue(cat.name);
    }

    // 3) Features
    const featuresRes = await api.get('/product_features', {
      params: {
        output_format: 'JSON',
        display: '[id,name]'
      }
    });

    const featuresList = featuresRes.data.product_features || [];
    const featuresMap = {};

    for (const feature of featuresList) {
      featuresMap[String(feature.id)] = getLangValue(feature.name);
    }

    // 4) Valeurs des features
    const featureValuesRes = await api.get('/product_feature_values', {
      params: {
        output_format: 'JSON',
        display: '[id,id_feature,value]'
      }
    });

    const featureValuesList = featureValuesRes.data.product_feature_values || [];
    const featureValuesMap = {};

    for (const featureValue of featureValuesList) {
      featureValuesMap[String(featureValue.id)] = {
        id_feature: String(featureValue.id_feature),
        value: getLangValue(featureValue.value)
      };
    }

    // 5) Construction des résultats
    let results = await Promise.all(
      products.map(async (product) => {
        const id = product.id;
        const nom = getLangValue(product.name);
        const prix = parseFloat(product.price || 0).toFixed(2);
        const slug = getLangValue(product.link_rewrite);
        const description = stripHtml(getLangValue(product.description_short));

        const imageUrl = product.id_default_image
          ? `${SHOP_URL}/${product.id_default_image}-large_default/${id}.jpg`
          : 'https://via.placeholder.com/220x200?text=Image+indisponible';

        const lien = slug
          ? `${SHOP_URL}/fr/nos-modeles/${id}-${slug}.html`
          : SHOP_URL;

        // Catégories du produit
        const productCategories = product.associations?.categories || [];
        const categoriesNames = productCategories
          .map((cat) => categoriesMap[String(cat.id)] || `Catégorie ${cat.id}`)
          .filter(Boolean);

        // Features du produit
        const productFeatures = product.associations?.product_features || [];
        const features = {};

        for (const pf of productFeatures) {
          const featureId = String(pf.id);
          const featureValueId = String(pf.id_feature_value);

          const featureName = featuresMap[featureId];
          const featureValue = featureValuesMap[featureValueId]?.value;

          if (featureName && featureValue) {
            features[featureName] = featureValue;
          }
        }

        const featureEntries = Object.entries(features);

        const featureNames = featureEntries.map(([key]) => key);
        const featureValues = featureEntries.map(([, value]) => value);

        const featuresText = featureEntries
          .map(([key, value]) => `${key}: ${value}`)
          .join(' | ');

        // Stock
        let qty = 0;
        try {
          const stockRes = await api.get('/stock_availables', {
            params: {
              output_format: 'JSON',
              display: '[quantity]',
              'filter[id_product]': `[${id}]`
            }
          });

          qty = parseInt(stockRes.data.stock_availables?.[0]?.quantity, 10) || 0;
        } catch (e) {
          console.error(`Erreur stock produit ${id}:`, e.message);
        }

        return {
          nom,
          prix: `${prix} €`,
          stock: qty > 0 ? 'En stock' : 'Rupture de stock',
          description,
          image: imageUrl,
          lien,
          categories: categoriesNames,
          features,
          feature_names: featureNames,
          feature_values: featureValues,
          features_text: featuresText
        };
      })
    );

    // 6) Recherche par nom
    if (rechercheNom) {
      results = results.filter((product) =>
        matchesAllWords(
          rechercheNom,
          product.nom,
          product.description
        )
      );
    }

    // 7) Recherche par catégorie
    if (rechercheCategorie) {
      results = results.filter((product) =>
        matchesAllWords(
          rechercheCategorie,
          product.categories
        )
      );
    }

    // 8) Recherche large par caractéristique
    if (rechercheFeature) {
      results = results.filter((product) =>
        matchesAllWords(
          rechercheFeature,
          product.feature_names,
          product.feature_values,
          product.features_text,
          product.categories,
          product.nom,
          product.description
        )
      );
    }

    res.json({ produits: results });

  } catch (err) {
    console.error('Erreur :', err.response?.data || err.message);
    res.status(500).json({ erreur: 'Erreur serveur' });
  }
});

// Page d'accueil
app.get('/', async (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="fr">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Exalto - Catalogue</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Segoe UI', sans-serif; background: #f5f5f5; padding: 30px; }
        h1 { text-align: center; margin-bottom: 30px; color: #333; font-size: 28px; }

        .filters {
          display: flex;
          gap: 15px;
          justify-content: center;
          flex-wrap: wrap;
          margin-bottom: 30px;
        }

        .filters input {
          padding: 12px 20px;
          width: 280px;
          border: 2px solid #ddd;
          border-radius: 25px;
          font-size: 16px;
          outline: none;
        }

        .filters input:focus {
          border-color: #333;
        }

        .grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
          gap: 20px;
        }

        .card {
          background: white;
          border-radius: 12px;
          overflow: hidden;
          box-shadow: 0 2px 8px rgba(0,0,0,0.08);
          transition: transform 0.2s;
        }

        .card:hover { transform: translateY(-4px); }

        .card img {
          width: 100%;
          height: 220px;
          object-fit: cover;
        }

        .card-body { padding: 15px; }

        .card-body h3 {
          font-size: 15px;
          color: #333;
          margin-bottom: 8px;
          min-height: 42px;
        }

        .prix {
          font-weight: bold;
          color: #222;
          font-size: 16px;
        }

        .stock {
          display: inline-block;
          margin-top: 8px;
          padding: 3px 10px;
          border-radius: 20px;
          font-size: 12px;
          font-weight: bold;
        }

        .stock.dispo {
          background: #e6f4ea;
          color: #2e7d32;
        }

        .stock.rupture {
          background: #fce8e6;
          color: #c62828;
        }

        .categories, .features {
          margin-top: 10px;
          font-size: 12px;
          color: #666;
          line-height: 1.5;
        }

        .features ul {
          margin-top: 6px;
          padding-left: 18px;
        }

        .features li {
          margin-bottom: 4px;
        }

        .btn {
          display: block;
          margin-top: 12px;
          text-align: center;
          padding: 8px;
          background: #333;
          color: white;
          border-radius: 8px;
          text-decoration: none;
          font-size: 13px;
        }

        .btn:hover { background: #555; }

        #count {
          text-align: center;
          color: #888;
          margin-bottom: 20px;
          font-size: 14px;
        }
      </style>
    </head>
    <body>
      <h1>🗂️ Catalogue Exalto</h1>

      <div class="filters">
        <input type="text" id="searchName" placeholder="Rechercher un produit...">
        <input type="text" id="searchCategory" placeholder="Rechercher par catégorie...">
        <input type="text" id="searchFeature" placeholder="Rechercher par caractéristique...">
      </div>

      <p id="count"></p>
      <div class="grid" id="grid"></div>

      <script>
        let timer;

        async function loadProducts(nom = '', categorie = '', feature = '') {
          const params = new URLSearchParams();

          if (nom) params.append('nom', nom);
          if (categorie) params.append('categorie', categorie);
          if (feature) params.append('feature', feature);

          const url = params.toString() ? '/produits?' + params.toString() : '/produits';

          const res = await fetch(url);
          const data = await res.json();
          render(data.produits || []);
        }

        function render(products) {
          const grid = document.getElementById('grid');
          const count = document.getElementById('count');
          count.textContent = products.length + ' produit(s) trouvé(s)';

          grid.innerHTML = products.map(p => {
            const featuresHtml = Object.entries(p.features || {})
              .map(([key, value]) => \`<li><strong>\${key} :</strong> \${value}</li>\`)
              .join('');

            return \`
              <div class="card">
                <img src="\${p.image}" alt="\${p.nom}" onerror="this.src='https://via.placeholder.com/220x200?text=Image+indisponible'">
                <div class="card-body">
                  <h3>\${p.nom}</h3>
                  <div class="prix">\${p.prix}</div>
                  <span class="stock \${p.stock === 'En stock' ? 'dispo' : 'rupture'}">\${p.stock}</span>
                  <div class="categories"><strong>Catégories :</strong> \${(p.categories || []).join(', ')}</div>
                  <div class="features">
                    <strong>Caractéristiques :</strong>
                    <ul>\${featuresHtml || '<li>Aucune caractéristique</li>'}</ul>
                  </div>
                  <a class="btn" href="\${p.lien}" target="_blank" rel="noopener noreferrer">Voir le produit</a>
                </div>
              </div>
            \`;
          }).join('');
        }

        function triggerSearch() {
          const nom = document.getElementById('searchName').value.trim();
          const categorie = document.getElementById('searchCategory').value.trim();
          const feature = document.getElementById('searchFeature').value.trim();

          clearTimeout(timer);
          timer = setTimeout(() => {
            loadProducts(nom, categorie, feature);
          }, 300);
        }

        document.getElementById('searchName').addEventListener('input', triggerSearch);
        document.getElementById('searchCategory').addEventListener('input', triggerSearch);
        document.getElementById('searchFeature').addEventListener('input', triggerSearch);

        loadProducts();
      </script>
    </body>
    </html>
  `);
});

// Démarre le serveur
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`✅ Serveur démarré sur http://localhost:${PORT}`);
  console.log(`📦 Route disponible : http://localhost:${PORT}/produits`);
});