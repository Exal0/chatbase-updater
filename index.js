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

// Config axios
const api = axios.create({
  baseURL: `${SHOP_URL}/api`,
  auth: { username: API_KEY, password: '' },
  params: { output_format: 'JSON' }
});

// Route que Chatbase va appeler
app.get('/produits', async (req, res) => {
  try {
    const recherche = req.query.nom?.toLowerCase() || '';

    // 🔥 Récupère les produits AVEC associations
    const prodRes = await api.get('/products', {
      params: {
        output_format: 'JSON',
        display: '[id,name,price,description_short,active,id_default_image,link_rewrite,associations]',
        filter: { active: 1 }
      }
    });

    let products = prodRes.data.products;

    // 🧪 DEBUG (tu peux enlever après)
    console.log("TOTAL PRODUITS:", products.length);
    console.log("EXEMPLE PRODUIT:", JSON.stringify(products[0], null, 2));

    // ✅ Filtre par catégories (MULTI catégories)
    products = products.filter(p => {
      const categories = p.associations?.categories || [];

      return categories.some(cat =>
        CATEGORIES_AUTORISEES.includes(Number(cat.id))
      );
    });

    console.log("APRÈS FILTRE CAT:", products.length);

    // 🔍 Filtre par nom
    if (recherche) {
      products = products.filter(p =>
        p.name?.[0]?.value?.toLowerCase().includes(recherche)
      );
    }

    // 🚀 Récupère les données + stock
    const results = await Promise.all(products.map(async (product) => {
      const id = product.id;
      const nom = product.name?.[0]?.value || '';
      const prix = parseFloat(product.price || 0).toFixed(2);
      const slug = product.link_rewrite?.[0]?.value || '';
      const description = product.description_short?.[0]?.value
        ?.replace(/<[^>]*>/g, '')
        .trim() || '';

      const imageUrl = `${SHOP_URL}/${product.id_default_image}-large_default/${id}.jpg`;
      const lien = `${SHOP_URL}/fr/nos-modeles/${id}-${slug}.html`;

      // ⚠️ Stock (fallback safe)
      let qty = 0;
      try {
        const stockRes = await api.get('/stock_availables', {
          params: {
            output_format: 'JSON',
            display: '[quantity]',
            filter: { id_product: id }
          }
        });

        qty = parseInt(stockRes.data.stock_availables?.[0]?.quantity) || 0;
      } catch (e) {
        console.log(`Erreur stock produit ${id}`);
      }

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

// Démarre le serveur
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`✅ Serveur démarré sur http://localhost:${PORT}`);
  console.log(`📦 Route disponible : http://localhost:${PORT}/produits`);
});