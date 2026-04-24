const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// CONFIG
const API_KEY = process.env.PRESTASHOP_API_KEY || 'REMPLACE_PAR_TA_CLE_API';
const SHOP_URL = 'https://www.exalto-professional-shop.com';
const EXCLUDED_CATEGORIES = ['avignon', 'nimes', 'terrade'];

const api = axios.create({
  baseURL: `${SHOP_URL}/api`,
  auth: { username: API_KEY, password: '' },
  params: { output_format: 'JSON' }
});

// Nettoie HTML
function stripHtml(str = '') {
  return String(str)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Champs multilangues PrestaShop
function getLangValue(field) {
  if (!field) return '';
  if (Array.isArray(field)) return field[0]?.value || '';
  if (typeof field === 'object' && field.value) return field.value;
  if (typeof field === 'string') return field;
  return '';
}

// Normalisation
function normalizeText(str = '') {
  return String(str)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitSearchWords(str = '') {
  return normalizeText(str).split(/\s+/).filter(Boolean);
}

function matchesAllWords(search, ...fields) {
  const words = splitSearchWords(search);
  if (!words.length) return true;

  const haystack = normalizeText(
    fields.flat(Infinity).filter(Boolean).join(' ')
  );

  return words.every(word => haystack.includes(word));
}

function hasExcludedCategory(categories = []) {
  return categories.some(category => {
    const normalizedCategory = normalizeText(category);
    return EXCLUDED_CATEGORIES.some(excluded =>
      normalizedCategory.includes(excluded)
    );
  });
}

function buildShortDescription(features = {}) {
  const parts = [];

  if (features['Couleur']) parts.push(features['Couleur']);
  if (features['Longueur']) parts.push(features['Longueur']);
  if (features['Type de cheveux']) parts.push(features['Type de cheveux']);
  if (features['Densité']) parts.push(`densité ${features['Densité']}`);
  if (features['Utilité']) parts.push(`idéal pour ${features['Utilité']}`);

  return parts.length
    ? `Tête malléable ${parts.join(', ')}.`
    : 'Tête malléable professionnelle.';
}

function cleanFeatureValue(value = '') {
  return String(value).replace(/\s+/g, ' ').trim();
}

function toChatbaseProduct(product) {
  const features = product.features || {};

  const tags = [
    features['Couleur'],
    features['Longueur'],
    features['Type de cheveux'],
    features['Densité'],
    features['Utilité'],
    features['Implantation'],
    product.stock
  ].filter(Boolean);

  return {
    name: product.nom,
    price: product.prix,
    stock: product.stock,
    url: product.lien,
    image: product.image,
    description: product.description || buildShortDescription(features),
    categories: product.categories,
    features: {
      color: features['Couleur'] || '',
      length: features['Longueur'] || '',
      hair_type: features['Type de cheveux'] || '',
      density: features['Densité'] || '',
      usage: features['Utilité'] || '',
      implantation: features['Implantation'] || '',
      reduction: features['Reduction'] || ''
    },
    tags,
    cta: 'Voir le produit'
  };
}

// Route principale Chatbase
app.get('/produits', async (req, res) => {
  try {
    const query = (req.query.query || '').trim();

    const prodRes = await api.get('/products', {
      params: {
        output_format: 'JSON',
        display: 'full',
        'filter[active]': '[1]'
      }
    });

    const products = prodRes.data.products || [];

    const categoriesRes = await api.get('/categories', {
      params: {
        output_format: 'JSON',
        display: '[id,name]'
      }
    });

    const categoriesMap = {};
    for (const cat of categoriesRes.data.categories || []) {
      categoriesMap[String(cat.id)] = getLangValue(cat.name);
    }

    const featuresRes = await api.get('/product_features', {
      params: {
        output_format: 'JSON',
        display: '[id,name]'
      }
    });

    const featuresMap = {};
    for (const feature of featuresRes.data.product_features || []) {
      featuresMap[String(feature.id)] = getLangValue(feature.name);
    }

    const featureValuesRes = await api.get('/product_feature_values', {
      params: {
        output_format: 'JSON',
        display: '[id,id_feature,value]'
      }
    });

    const featureValuesMap = {};
    for (const featureValue of featureValuesRes.data.product_feature_values || []) {
      featureValuesMap[String(featureValue.id)] = {
        id_feature: String(featureValue.id_feature),
        value: getLangValue(featureValue.value)
      };
    }

    let results = await Promise.all(
      products.map(async product => {
        const id = product.id;
        const nom = getLangValue(product.name);
        const prix = `${parseFloat(product.price || 0).toFixed(2)} €`;
        const slug = getLangValue(product.link_rewrite);
        const description = stripHtml(getLangValue(product.description_short));

        const image = product.id_default_image
          ? `${SHOP_URL}/${product.id_default_image}-large_default/${id}.jpg`
          : 'https://via.placeholder.com/220x200?text=Image+indisponible';

        const lien = slug
          ? `${SHOP_URL}/fr/nos-modeles/${id}-${slug}.html`
          : SHOP_URL;

        const productCategories = product.associations?.categories || [];
        const categories = productCategories
          .map(cat => categoriesMap[String(cat.id)] || '')
          .filter(Boolean);

        const productFeatures = product.associations?.product_features || [];
        const features = {};

        for (const pf of productFeatures) {
          const featureId = String(pf.id);
          const featureValueId = String(pf.id_feature_value);

          const featureName = featuresMap[featureId];
          const featureValue = featureValuesMap[featureValueId]?.value;

          if (featureName && featureValue) {
            features[featureName] = cleanFeatureValue(featureValue);
          }
        }

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
          prix,
          stock: qty > 0 ? 'En stock' : 'Rupture de stock',
          description,
          image,
          lien,
          categories,
          features
        };
      })
    );

    results = results.filter(product => !hasExcludedCategory(product.categories));

    let chatbaseResults = results.map(toChatbaseProduct);

    if (query) {
      chatbaseResults = chatbaseResults.filter(product =>
        matchesAllWords(
          query,
          product.name,
          product.description,
          product.categories,
          product.tags,
          Object.values(product.features || {})
        )
      );
    }

    chatbaseResults = chatbaseResults.slice(0, 5);

    res.json({
      query,
      count: chatbaseResults.length,
      results: chatbaseResults
    });

  } catch (err) {
    console.error('Erreur :', err.response?.data || err.message);
    res.status(500).json({
      error: true,
      message: 'Erreur serveur pendant la recherche produits.'
    });
  }
});

// Page test navigateur
app.get('/', async (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="fr">
    <head>
      <meta charset="UTF-8">
      <title>Catalogue Exalto API</title>
      <style>
        body { font-family: Arial, sans-serif; background:#f5f5f5; padding:30px; }
        h1 { text-align:center; }
        .search { text-align:center; margin-bottom:25px; }
        input { padding:12px; width:320px; border:1px solid #ccc; }
        .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(240px,1fr)); gap:20px; }
        .card { background:white; padding:15px; border-radius:10px; box-shadow:0 2px 8px rgba(0,0,0,.08); }
        .card img { width:100%; height:220px; object-fit:cover; }
        .price { font-weight:bold; margin:8px 0; }
        .stock { font-size:13px; color:#1d6e75; }
        .tags { font-size:12px; color:#666; margin:10px 0; }
        a { display:block; background:#1d6e75; color:white; text-align:center; padding:10px; text-decoration:none; margin-top:10px; }
      </style>
    </head>
    <body>
      <h1>Catalogue Exalto API</h1>

      <div class="search">
        <input id="search" placeholder="Ex : tête blonde 35cm coloration">
      </div>

      <p id="count"></p>
      <div class="grid" id="grid"></div>

      <script>
        let timer;

        async function loadProducts(query = '') {
          const url = query ? '/produits?query=' + encodeURIComponent(query) : '/produits';
          const res = await fetch(url);
          const data = await res.json();
          render(data.results || []);
        }

        function render(products) {
          document.getElementById('count').textContent = products.length + ' produit(s) trouvé(s)';

          document.getElementById('grid').innerHTML = products.map(p => \`
            <div class="card">
              <img src="\${p.image}" alt="\${p.name}">
              <h3>\${p.name}</h3>
              <div class="price">\${p.price}</div>
              <div class="stock">\${p.stock}</div>
              <p>\${p.description}</p>
              <div class="tags">\${(p.tags || []).join(' • ')}</div>
              <a href="\${p.url}" target="_blank">\${p.cta}</a>
            </div>
          \`).join('');
        }

        document.getElementById('search').addEventListener('input', e => {
          clearTimeout(timer);
          timer = setTimeout(() => loadProducts(e.target.value.trim()), 300);
        });

        loadProducts();
      </script>
    </body>
    </html>
  `);
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(\`Serveur démarré sur http://localhost:\${PORT}\`);
  console.log(\`Route Chatbase : http://localhost:\${PORT}/produits?query=blonde\`);
});