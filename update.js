const fs = require('fs');
const axios = require('axios');

// ⚙️ CONFIG
const API_KEY = '7VA33R1WLZPM4Q642HNQ3M62EKFMKSF3';
const SHOP_URL = 'https://www.exalto-professional-shop.com';
const OUTPUT_FILE = './chatbase_produits.txt';

// ✅ Catégories autorisées
const CATEGORIES_AUTORISEES = [4, 5, 6, 7, 11, 12, 13];

// Config axios pour l'API PrestaShop
const api = axios.create({
  baseURL: `${SHOP_URL}/api`,
  auth: { username: API_KEY, password: '' },
  params: { output_format: 'JSON' }
});

// Convertit le nom en slug pour l'URL
function makeSlug(nom) {
  return nom
    .toLowerCase()
    .replace(/[àâä]/g, 'a')
    .replace(/[éèêë]/g, 'e')
    .replace(/[îï]/g, 'i')
    .replace(/[ôö]/g, 'o')
    .replace(/[ùûü]/g, 'u')
    .replace(/ç/g, 'c')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// Récupère tous les produits actifs
async function getProducts() {
  console.log('📦 Récupération des produits...');
  const res = await api.get('/products', {
    params: {
      output_format: 'JSON',
      display: '[id,name,price,description_short,active,id_default_image,link_rewrite,id_category_default]',
      filter: { active: 1 }
    }
  });
  return res.data.products;
}

// Récupère le stock d'un produit
async function getStock(productId) {
  const res = await api.get('/stock_availables', {
    params: {
      output_format: 'JSON',
      display: '[quantity]',
      filter: { id_product: productId }
    }
  });
  const stocks = res.data.stock_availables;
  if (!stocks || stocks.length === 0) return 0;
  return parseInt(stocks[0].quantity) || 0;
}

// Génère l'URL de l'image principale
function getImageUrl(productId, imageId) {
  return `${SHOP_URL}/${imageId}-large_default/${productId}.jpg`;
}

// Génère le fichier txt
async function generate() {
  console.log('🚀 Démarrage...\n');

  const products = await getProducts();

  // Filtre par catégories autorisées
  const filtres = products.filter(p =>
    CATEGORIES_AUTORISEES.includes(parseInt(p.id_category_default))
  );

  console.log(`✅ ${filtres.length} produits trouvés dans les catégories sélectionnées\n`);

  const lines = [];

  for (const product of filtres) {
    const id = product.id;
    const nom = product.name[0]?.value || '';
    const description = product.description_short[0]?.value
      ?.replace(/<[^>]*>/g, '')
      .trim() || '';
    const prix = parseFloat(product.price).toFixed(2);
    const slug = product.link_rewrite[0]?.value || makeSlug(nom);
    const imageUrl = getImageUrl(id, product.id_default_image);
    const lien = `${SHOP_URL}/fr/nos-modeles/${id}-${slug}.html`;

    console.log(`🔄 Stock pour : ${nom}`);
    const qty = await getStock(id);
    const stock = qty > 0 ? 'En stock' : 'Rupture de stock';

    lines.push(`Produit : ${nom}
Prix TTC : ${prix} €
Stock : ${stock}
Description : ${description}
Image : ${imageUrl}
Lien : ${lien}
---`);
  }

  fs.writeFileSync(OUTPUT_FILE, lines.join('\n'), 'utf-8');
  console.log(`\n✅ Fichier généré : ${OUTPUT_FILE}`);
  console.log(`📦 ${filtres.length} produits exportés`);
}

generate().catch(err => {
  console.error('❌ Erreur :', err.message);
});