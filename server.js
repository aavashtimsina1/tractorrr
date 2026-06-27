const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Database setup
let dbPath;
if (process.env.RENDER && fs.existsSync('/data')) {
  dbPath = path.join('/data', 'timsina_tractor.db');
} else {
  dbPath = path.join(__dirname, 'timsina_tractor.db');
}

console.log(`📁 Database path: ${dbPath}`);

const db = new sqlite3.Database(dbPath);

// Create tables
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fullName TEXT NOT NULL,
      phone TEXT,
      serviceType TEXT,
      timeNeeded REAL,
      billingAmount REAL,
      description TEXT,
      date TEXT,
      createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Insert sample data
  db.get("SELECT COUNT(*) as count FROM customers", (err, row) => {
    if (err) {
      console.error('Error checking database:', err);
      return;
    }
    if (row.count === 0) {
      const today = new Date().toISOString().split('T')[0];
      const sampleData = [
        ['Green Valley Farm', '+1 555 1010', 'Ploughing', 4.5, 320.00, '12 acres, clay soil, deep ploughing', today],
        ['Sunrise Orchards', '+1 555 2020', 'Seeding', 2.0, 180.50, 'seeding cover crop, 8 acres', today],
        ['Riverbend Crops', '+1 555 3030', 'Harvesting', 6.0, 540.00, 'wheat harvest, 20 acres, dry', today],
        ['Green Valley Farm', '+1 555 1010', 'Seeding', 3.0, 210.00, 'additional seeding, 6 acres', today]
      ];

      const stmt = db.prepare("INSERT INTO customers (fullName, phone, serviceType, timeNeeded, billingAmount, description, date) VALUES (?, ?, ?, ?, ?, ?, ?)");
      sampleData.forEach(row => {
        stmt.run(row);
      });
      stmt.finalize();
      console.log('✅ Sample data inserted successfully');
    }
  });
});

// ============ API ROUTES ============

// Get all customers
app.get('/api/customers', (req, res) => {
  db.all("SELECT * FROM customers ORDER BY id DESC", (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json({
      data: rows,
      timestamp: Date.now(),
      count: rows.length
    });
  });
});

// Get customer by ID
app.get('/api/customers/:id', (req, res) => {
  const id = req.params.id;
  db.get("SELECT * FROM customers WHERE id = ?", [id], (err, row) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    if (!row) {
      res.status(404).json({ error: 'Customer not found' });
      return;
    }
    res.json(row);
  });
});

// Create customer
app.post('/api/customers', (req, res) => {
  const { fullName, phone, serviceType, timeNeeded, billingAmount, description, date } = req.body;
  
  if (!fullName) {
    res.status(400).json({ error: 'Full name is required' });
    return;
  }

  const currentDate = date || new Date().toISOString().split('T')[0];

  db.run(
    "INSERT INTO customers (fullName, phone, serviceType, timeNeeded, billingAmount, description, date) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [fullName, phone, serviceType, timeNeeded, billingAmount, description, currentDate],
    function(err) {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      
      db.get("SELECT * FROM customers WHERE id = ?", [this.lastID], (err, row) => {
        if (err) {
          res.status(500).json({ error: err.message });
          return;
        }
        res.json(row);
      });
    }
  );
});

// Update customer
app.put('/api/customers/:id', (req, res) => {
  const id = req.params.id;
  const { fullName, phone, serviceType, timeNeeded, billingAmount, description, date } = req.body;

  db.run(
    "UPDATE customers SET fullName = ?, phone = ?, serviceType = ?, timeNeeded = ?, billingAmount = ?, description = ?, date = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?",
    [fullName, phone, serviceType, timeNeeded, billingAmount, description, date, id],
    function(err) {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      if (this.changes === 0) {
        res.status(404).json({ error: 'Customer not found' });
        return;
      }
      
      db.get("SELECT * FROM customers WHERE id = ?", [id], (err, row) => {
        if (err) {
          res.status(500).json({ error: err.message });
          return;
        }
        res.json(row);
      });
    }
  );
});

// Delete customer
app.delete('/api/customers/:id', (req, res) => {
  const id = req.params.id;
  
  db.run("DELETE FROM customers WHERE id = ?", [id], function(err) {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    if (this.changes === 0) {
      res.status(404).json({ error: 'Customer not found' });
      return;
    }
    
    res.json({ message: 'Customer deleted successfully', id: id });
  });
});

// Delete all customers
app.delete('/api/customers', (req, res) => {
  db.run("DELETE FROM customers", function(err) {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    db.run("DELETE FROM sqlite_sequence WHERE name='customers'");
    res.json({ message: 'All customers deleted successfully' });
  });
});

// Search customers
app.get('/api/search', (req, res) => {
  const query = req.query.q || '';
  const searchTerm = `%${query}%`;
  
  db.all(
    "SELECT * FROM customers WHERE fullName LIKE ? OR phone LIKE ? OR serviceType LIKE ? OR description LIKE ? ORDER BY id DESC",
    [searchTerm, searchTerm, searchTerm, searchTerm],
    (err, rows) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      res.json(rows);
    }
  );
});

// Combine duplicates
app.post('/api/combine', (req, res) => {
  db.all("SELECT * FROM customers ORDER BY id", (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }

    const map = new Map();
    const toRemove = [];

    rows.forEach(c => {
      const key = c.fullName.trim().toLowerCase();
      if (!map.has(key)) {
        map.set(key, { 
          master: { ...c }, 
          entries: [{ ...c }],
          ids: [c.id]
        });
      } else {
        const group = map.get(key);
        group.entries.push({ ...c });
        group.ids.push(c.id);
        toRemove.push(c.id);
      }
    });

    if (toRemove.length === 0) {
      res.json({ message: 'No duplicates found', combined: 0 });
      return;
    }

    db.serialize(() => {
      db.run("BEGIN TRANSACTION");

      const placeholders = toRemove.map(() => '?').join(',');
      db.run(`DELETE FROM customers WHERE id IN (${placeholders})`, toRemove, function(err) {
        if (err) {
          db.run("ROLLBACK");
          res.status(500).json({ error: err.message });
          return;
        }

        const stmt = db.prepare(
          "INSERT OR REPLACE INTO combined_records (customerName, entries, totalAmount, totalTime) VALUES (?, ?, ?, ?)"
        );

        map.forEach((group, key) => {
          const master = group.master;
          let totalAmount = 0;
          let totalTime = 0;
          group.entries.forEach(e => {
            totalAmount += parseFloat(e.billingAmount) || 0;
            totalTime += parseFloat(e.timeNeeded) || 0;
          });
          
          stmt.run(
            master.fullName,
            JSON.stringify(group.entries),
            totalAmount,
            totalTime
          );
        });

        stmt.finalize();

        db.run("COMMIT", (err) => {
          if (err) {
            db.run("ROLLBACK");
            res.status(500).json({ error: err.message });
            return;
          }
          res.json({ 
            message: `Successfully combined ${toRemove.length} duplicate records`,
            combined: toRemove.length
          });
        });
      });
    });
  });
});

// Get combined records
app.get('/api/combined', (req, res) => {
  db.all("SELECT * FROM combined_records ORDER BY id DESC", (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    const parsedRows = rows.map(row => {
      try {
        row.entries = JSON.parse(row.entries);
      } catch (e) {
        row.entries = [];
      }
      return row;
    });
    res.json(parsedRows);
  });
});

// Get stats
app.get('/api/stats', (req, res) => {
  db.get(
    "SELECT COUNT(*) as totalRecords, SUM(billingAmount) as totalBilled, AVG(timeNeeded) as avgTime FROM customers",
    (err, row) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      res.json({
        totalRecords: row.totalRecords || 0,
        totalBilled: row.totalBilled || 0,
        avgTime: row.avgTime || 0
      });
    }
  );
});

// Health check endpoint
app.get('/health', (req, res) => {
  db.get("SELECT 1", (err) => {
    if (err) {
      res.status(500).json({ status: 'ERROR', error: err.message });
      return;
    }
    res.json({ 
      status: 'OK', 
      timestamp: new Date().toISOString(),
      database: dbPath
    });
  });
});

// ============ IMPORTANT: Serve index.html for all other routes ============
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server is running on port ${PORT}`);
  console.log(`🌐 Local: http://localhost:${PORT}`);
  if (process.env.RENDER) {
    console.log(`🚀 Live: https://${process.env.RENDER_SERVICE_NAME}.onrender.com`);
  }
  console.log(`📁 Database: ${dbPath}`);
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err);
    }
    console.log('Database connection closed');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err);
    }
    console.log('Database connection closed');
    process.exit(0);
  });
});