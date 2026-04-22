const fs = require('fs');
const axios = require('axios');
const https = require('https');

// ⚙️ CONFIG
const API_KEY = '7VA33R1WLZPM4Q642HNQ3M62EKFMKSF3';
const SHOP_URL = 'https://www.exalto-professional-shop.com';
const OUTPUT_FILE = './chatbase_produits.txt';

const CATEGORIES_AUTORISEES = [4, 5, 6, 7, 11, 12, 13];

const EXCLUDED_KEYWORDS = [
  'ancienne collection',
  'old',
  'ancien',
  'archive'
];

const api = axios.create({
  baseURL: `${SHOP_URL}/api`,
  auth: { username: API_KEY, password: '' },
  httpsAgent: new https.Agent({ rejectUnauthorized: false }),
  params: { output_format: 'JSON' }
});

// 🧼 CLEAN TEXT
function cleanText(text = '') {
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ✂️ DESCRIPTION
function makeShortDescription(desc) {
  return cleanText(desc).substring(0, 150);
}

// 🚫 EXCLUSION COLLECTIONS
function isExcluded(product) {
  const name = product.name?.[0]?.value?.toLowerCase() || '';
  return EXCLUDED_KEYWORDS.some(k => name.includes(k));
}

// 🔤 SLUG SAFE
function makeSlug(nom) {
  return nom
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// 📂 CATÉGORIES
async function getAllCategories() {
  const res = await api.get('/categories', {
    params: { display: '[id,name]' }
  });

  const map = {};
  for (const c of res.data.categories) {
    map[Number(c.id)] = c.name?.[0]?.value || '';
  }

  return map;
}

// 📦 PRODUITS
async function getProducts() {
  const res = await api.get('/products', {
    params: {
      display: '[id,name,price,description_short,description,id_default_image,link_rewrite,id_category_default]',
      'filter[active]': 1
    }
  });

  return res.data.products;
}

// 📊 STOCK
async function getStock(id) {
  const res = await api.get('/stock_availables', {
    params: {
      display: '[quantity]',
      'filter[id_product]': id
    }
  });

  const s = res.data.stock_availables;
  return s?.length ? parseInt(s[0].quantity) || 0 : 0;
}

// 🖼️ IMAGE PRESTASHOP CORRIGÉE (IMPORTANT)
function getImageUrl(product) {
  if (!product.id_default_image) return '';

  const idStr = String(product.id_default_image);
  const path = idStr.split('').join('/');

  return `${SHOP_URL}/img/p/${path}/${idStr}.jpg`;
}

// 🔗 LIEN ULTRA SAFE
function getProductLink(product) {
  return `${SHOP_URL}/index.php?id_product=${product.id}&controller=product`;
}

// 🚀 MAIN
async function generate() {
  console.log('🚀 Génération en cours...\n');

  const [products, categoriesMap] = await Promise.all([
    getProducts(),
    getAllCategories()
  ]);

  const filtres = products.filter(p => {
    const catOk = CATEGORIES_AUTORISEES.includes(parseInt(p.id_category_default));
    const notExcluded = !isExcluded(p);
    return catOk && notExcluded;
  });

  console.log(`📦 Produits OK : ${filtres.length}\n`);

  const lines = [];

  await Promise.all(filtres.map(async (p) => {
    try {
      const nom = p.name?.[0]?.value || '';
      const prix = parseFloat(p.price).toFixed(2);

      const desc = makeShortDescription(
        p.description_short?.[0]?.value ||
        p.description?.[0]?.value ||
        ''
      );

      const stock = (await getStock(p.id)) > 0 ? 'En stock' : 'Rupture de stock';

      const image = getImageUrl(p);
      const link = getProductLink(p);

      // 🔥 CATÉGORIE SAFE
      let cat = categoriesMap[p.id_category_default] || 'Non catégorisé';

      console.log(`✔ ${nom}`);

      lines.push(
`[![${nom}](${image})](${link})

**${nom}**

${prix} € | ${stock}

Catégories : ${cat}

${desc}

---`
      );

    } catch (e) {
      console.log(`❌ Produit skip ID ${p.id}`);
    }
  }));

  fs.writeFileSync(OUTPUT_FILE, lines.join('\n'), 'utf-8');

  console.log(`\n✅ TERMINÉ : ${OUTPUT_FILE}`);
  console.log(`📦 ${filtres.length} produits exportés`);
}

generate().catch(err => {
  console.error('❌ ERREUR:', err.response?.status || '', err.message);
});