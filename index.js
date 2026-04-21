const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// ⚙️ CONFIG
const API_KEY = '7VA33R1WLZPM4Q642HNQ3M62EKFMKSF3';
const SHOP_URL = 'https://www.exalto-professional-shop.com';

const api = axios.create({
  baseURL: `${SHOP_URL}/api`,
  auth: { username: API_KEY, password: '' },
  params: { output_format: 'JSON' }
});

// Route principale pour Chatbase et le Catalogue
app.get('/produits', async (req, res) => {
  try {
    const recherche = req.query.nom?.toLowerCase() || '';
    const categorie = req.query.categorie?.toLowerCase() || '';

    // Récupère les produits actifs
    const prodRes = await api.get('/products', {
      params: {
        display: '[id,name,price,description_short,description,active,id_default_image,link_rewrite]',
        filter: { active: 1 }
      }
    });

    let products = prodRes.data.products || [];

    // 1. FILTRAGE PAR CATÉGORIE (Logique Claude)
    if (categorie === 'homme') {
      products = products.filter(p =>
        p.name[0]?.value?.toLowerCase().includes('homme') ||
        p.description[0]?.value?.toLowerCase().includes('homme') ||
        p.description_short[0]?.value?.toLowerCase().includes('homme')
      );
    } else if (categorie === 'femme') {
      products = products.filter(p =>
        p.name[0]?.value?.toLowerCase().includes('femme') ||
        p.description_short[0]?.value?.toLowerCase().includes('femme')
      );
    }

    // 2. FILTRAGE PAR NOM (Recherche textuelle classique)
    if (recherche) {
      products = products.filter(p =>
        p.name[0]?.value?.toLowerCase().includes(recherche) ||
        p.description_short[0]?.value?.toLowerCase().includes(recherche)
      );
    }

    // 3. RÉCUPÉRATION DES DÉTAILS ET DU STOCK
    const results = await Promise.all(products.map(async (product) => {
      const id = product.id;
      const nom = product.name[0]?.value || '';
      const prix = parseFloat(product.price).toFixed(2);
      const slug = product.link_rewrite[0]?.value || '';
      
      // Application de ta règle : remplacer "matière/fibre" par "cheveux"
      let description = (product.description_short[0]?.value || product.description[0]?.value || '')
        .replace(/<[^>]*>/g, '') // Nettoyage HTML
        .replace(/fibre/gi, 'cheveux')
        .replace(/matière/gi, 'cheveux')
        .trim();

      const imageUrl = `${SHOP_URL}/${product.id_default_image}-large_default/${id}.jpg`;
      const lien = `${SHOP_URL}/fr/nos-modeles/${id}-${slug}.html`;

      // Récupération du stock
      const stockRes = await api.get('/stock_availables', {
        params: {
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

// Page d'accueil (Interface visuelle)
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="fr">
    <head>
      <meta charset="UTF-8">
      <title>Exalto - Catalogue</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Segoe UI', sans-serif; background: #f5f5f5; padding: 30px; }
        h1 { text-align: center; margin-bottom: 30px; color: #333; }
        #search { display: block; margin: 0 auto 30px; padding: 12px 20px; width: 400px; border: 2px solid #ddd; border-radius: 25px; outline: none; }
        .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 20px; }
        .card { background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
        .card img { width: 100%; height: 200px; object-fit: cover; }
        .card-body { padding: 15px; }
        .prix { font-weight: bold; margin-top: 5px; }
        .stock { font-size: 12px; font-weight: bold; padding: 3px 8px; border-radius: 10px; }
        .dispo { background: #e6f4ea; color: #2e7d32; }
        .rupture { background: #fce8e6; color: #c62828; }
        .btn { display: block; margin-top: 10px; text-align: center; padding: 8px; background: #333; color: white; text-decoration: none; border-radius: 5px; font-size: 13px; }
      </style>
    </head>
    <body>
      <h1>🗂️ Catalogue Exalto</h1>
      <input type="text" id="search" placeholder="Rechercher (ex: Alex, Homme, 100 % naturel...)">
      <div class="grid" id="grid"></div>
      <script>
        async function load(q = '') {
          const res = await fetch('/produits?nom=' + q);
          const data = await res.json();
          document.getElementById('grid').innerHTML = data.produits.map(p => \`
            <div class="card">
              <img src="\${p.image}">
              <div class="card-body">
                <h3>\${p.nom}</h3>
                <div class="prix">\${p.prix}</div>
                <span class="stock \${p.stock === 'En stock' ? 'dispo' : 'rupture'}">\${p.stock}</span>
                <a class="btn" href="\${p.lien}" target="_blank">Voir le produit</a>
              </div>
            </div>
          \`).join('');
        }
        document.getElementById('search').addEventListener('input', (e) => load(e.target.value));
        load();
      </script>
    </body>
    </html>
  `);
});

app.listen(3000, () => console.log('✅ Serveur actif sur http://localhost:3000'));