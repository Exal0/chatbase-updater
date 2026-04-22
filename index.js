const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// CONFIG
const API_KEY = '7VA33R1WLZPM4Q642HNQ3M62EKFMKSF3';
const SHOP_URL = 'https://www.exalto-professional-shop.com';
const CATEGORIES_AUTORISEES = [4, 5, 6, 7, 11, 12, 13];

// Instance Axios pour l'API PrestaShop
const api = axios.create({
  baseURL: `${SHOP_URL}/api`,
  auth: {
    username: API_KEY,
    password: '',
  },
  params: {
    output_format: 'JSON',
  },
});

// Route API : liste des produits
app.get('/produits', async (req, res) => {
  try {
    const recherche = (req.query.nom || '').toLowerCase().trim();

    // Récupération des produits actifs
    const prodRes = await api.get('/products', {
      params: {
        output_format: 'JSON',
        display: '[id,name,price,description_short,active,id_default_image,link_rewrite,id_category_default]',
        'filter[active]': '[1]',
      },
    });

    let products = prodRes.data.products || [];

    // Filtre catégories autorisées
    products = products.filter((p) =>
      CATEGORIES_AUTORISEES.includes(parseInt(p.id_category_default, 10))
    );

    // Filtre par nom si présent
    if (recherche) {
      products = products.filter((p) => {
        const nom = p.name?.[0]?.value?.toLowerCase() || '';
        return nom.includes(recherche);
      });
    }

    // Enrichissement des produits avec stock + formatage
    const results = await Promise.all(
      products.map(async (product) => {
        const id = product.id;
        const nom = product.name?.[0]?.value || '';
        const prix = Number.parseFloat(product.price || 0).toFixed(2);
        const slug = product.link_rewrite?.[0]?.value || '';
        const description =
          product.description_short?.[0]?.value
            ?.replace(/<[^>]*>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim() || '';

        const imageUrl = product.id_default_image
          ? `${SHOP_URL}/${product.id_default_image}-large_default/${id}.jpg`
          : 'https://via.placeholder.com/220x200?text=Image+indisponible';

        const lien = `${SHOP_URL}/fr/nos-modeles/${id}-${slug}.html`;

        let qty = 0;

        try {
          const stockRes = await api.get('/stock_availables', {
            params: {
              output_format: 'JSON',
              display: '[quantity]',
              'filter[id_product]': `[${id}]`,
            },
          });

          qty = parseInt(stockRes.data.stock_availables?.[0]?.quantity, 10) || 0;
        } catch (stockErr) {
          console.error(`Erreur stock produit ${id}:`, stockErr.message);
        }

        return {
          nom,
          prix: `${prix} €`,
          stock: qty > 0 ? 'En stock' : 'Rupture de stock',
          description,
          image: imageUrl,
          lien,
        };
      })
    );

    res.json({ produits: results });
  } catch (err) {
    console.error('Erreur /produits :', err.response?.data || err.message);
    res.status(500).json({
      erreur: 'Erreur serveur',
      details: err.response?.data || err.message,
    });
  }
});

// Page d'accueil simple pour visualiser le catalogue
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
        body {
          font-family: 'Segoe UI', sans-serif;
          background: #f5f5f5;
          padding: 30px;
          color: #333;
        }
        h1 {
          text-align: center;
          margin-bottom: 30px;
          font-size: 28px;
        }
        #search {
          display: block;
          margin: 0 auto 30px;
          padding: 12px 20px;
          width: 100%;
          max-width: 400px;
          border: 2px solid #ddd;
          border-radius: 25px;
          font-size: 16px;
          outline: none;
        }
        #search:focus {
          border-color: #333;
        }
        #count {
          text-align: center;
          color: #888;
          margin-bottom: 20px;
          font-size: 14px;
        }
        .grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
          gap: 20px;
        }
        .card {
          background: white;
          border-radius: 12px;
          overflow: hidden;
          box-shadow: 0 2px 8px rgba(0,0,0,0.08);
          transition: transform 0.2s;
        }
        .card:hover {
          transform: translateY(-4px);
        }
        .card img {
          width: 100%;
          height: 200px;
          object-fit: cover;
          display: block;
        }
        .card-body {
          padding: 15px;
        }
        .card-body h3 {
          font-size: 14px;
          color: #333;
          margin-bottom: 8px;
          min-height: 36px;
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
        .desc {
          margin-top: 10px;
          font-size: 13px;
          color: #666;
          line-height: 1.4;
          min-height: 54px;
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
        .btn:hover {
          background: #555;
        }
      </style>
    </head>
    <body>
      <h1>Catalogue Exalto</h1>
      <input type="text" id="search" placeholder="Rechercher un produit...">
      <p id="count"></p>
      <div class="grid" id="grid"></div>

      <script>
        async function loadProducts(nom = '') {
          try {
            const url = nom ? '/produits?nom=' + encodeURIComponent(nom) : '/produits';
            const res = await fetch(url);
            const data = await res.json();
            render(data.produits || []);
          } catch (e) {
            console.error('Erreur chargement produits :', e);
          }
        }

        function render(products) {
          const grid = document.getElementById('grid');
          const count = document.getElementById('count');

          count.textContent = products.length + ' produit(s) trouvé(s)';

          grid.innerHTML = products.map(p => \`
            <div class="card">
              <img
                src="\${p.image}"
                alt="\${escapeHtml(p.nom)}"
                onerror="this.src='https://via.placeholder.com/220x200?text=Image+indisponible'"
              >
              <div class="card-body">
                <h3>\${escapeHtml(p.nom)}</h3>
                <div class="prix">\${p.prix}</div>
                <span class="stock \${p.stock === 'En stock' ? 'dispo' : 'rupture'}">\${p.stock}</span>
                <div class="desc">\${escapeHtml(p.description)}</div>
                <a class="btn" href="\${p.lien}" target="_blank" rel="noopener noreferrer">Voir le produit</a>
              </div>
            </div>
          \`).join('');
        }

        function escapeHtml(str) {
          return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
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

// Lancement serveur
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Serveur démarré sur http://localhost:${PORT}`);
  console.log(`Route disponible : http://localhost:${PORT}/produits`);
});