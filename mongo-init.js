// Création de l'utilisateur admin
db = db.getSiblingDB('admin');
db.createUser({
  user: 'admin',
  pwd: 'admin123',
  roles: [
    { role: 'userAdminAnyDatabase', db: 'admin' },
    { role: 'readWriteAnyDatabase', db: 'admin' }
  ]
});

// Création de la base de données ecommerce et d'un utilisateur dédié
db = db.getSiblingDB('ecommerce');
db.createUser({
  user: 'ecommerce_user',
  pwd: 'ecommerce123',
  roles: [
    { role: 'readWrite', db: 'ecommerce' },
    { role: 'dbAdmin', db: 'ecommerce' }
  ]
});

// Création des collections initiales
db.createCollection('products');
db.createCollection('users');
db.createCollection('orders');

console.log('MongoDB initialization complete');
