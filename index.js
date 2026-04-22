const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const API_KEY = '7VA33R1WLZPM4Q642HNQ3M62EKFMKSF3';
const SHOP_URL = 'https://www.exalto-professional-shop.com';

const CATEGORIES_AUTORISEES = [4, 5, 6, 7, 11, 12, 13];

const api = axios.create({
  baseURL: `${SHOP_URL}/api`,
  auth: { username: API_KEY, password: '' }
});

app.get('/produits', async (req, res) => {
  try {
    const recherche = req.query.nom?.toLowerCase() || '';

    const prodRes = await api.get(
      `/products?output_format=JSON&display=[id,name,price,description_short,active,id_default_image,link_rewrite,id_category_default]&filter[active]=1`
    );

    let products = prodRes.data.products;

    console.log("TOTAL PRODUITS:", products.length);

    // ✅ FILTRE CATÉGORIES (SEULE OPTION POSSIBLE)
    products = products.filter(p =>
      CATEGORIES_AUTORISEES.includes(Number(p.id_category_default))
    );

    console.log("APRÈS FILTRE:", products.length);

    if (recherche) {
      products = products.filter(p =>
        p.name?.[0]?.value?.toLowerCase().includes(recherche)
      );
    }

    const results = products.map(product => {
      const id = product.id;
      const nom = product.name?.[0]?.value || '';
      const prix = parseFloat(product.price || 0).toFixed(2);
      const slug = product.link_rewrite?.[0]?.value || '';
      const description = product.description_short?.[0]?.value
        ?.replace(/<[^>]*>/g, '')
        .trim() || '';

      const image = `${SHOP_URL}/${product.id_default_image}-large_default/${id}.jpg`;
      const lien = `${SHOP_URL}/fr/nos-modeles/${id}-${slug}.html`;

      return {
        nom,
        prix: `${prix} €`,
        description,
        image,
        lien,
        categorie
      };
    });

    res.json({ produits: results });

  } catch (err) {
    console.error("ERREUR API:", err.response?.data || err.message);
    res.status(500).json({ erreur: "Erreur serveur" });
  }
});

app.listen(3000, () => {
  console.log("OK http://localhost:3000");
});