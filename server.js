const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

// File paths
const ordersFile = path.join(__dirname, 'orders.json');
const productMappingFile = path.join(__dirname, 'product_mapping.json');

// Helper functions to load and save orders
function loadOrders() {
  try {
    const data = fs.readFileSync(ordersFile, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error loading orders:', error);
    return [];
  }
}

function saveOrders(orders) {
  try {
    fs.writeFileSync(ordersFile, JSON.stringify(orders, null, 2), 'utf8');
  } catch (error) {
    console.error('Error saving orders:', error);
  }
}

// Load product mapping (assumed not to change frequently)
let productMapping = {};
function loadProductMapping() {
  try {
    const data = fs.readFileSync(productMappingFile, 'utf8');
    productMapping = JSON.parse(data);
  } catch (error) {
    console.error('Error loading product mapping:', error);
  }
}
loadProductMapping();

//
// CRUD Endpoints for Orders
//

// Get all orders
app.get('/orders', (req, res) => {
  const orders = loadOrders();
  res.json(orders);
});

// Get a specific order by order_id
app.get('/orders/:orderId', (req, res) => {
  const orders = loadOrders();
  const order = orders.find(o => o.order_id === req.params.orderId);
  if (!order) {
    return res.status(404).json({ message: 'Order not found' });
  }
  res.json(order);
});

// Create a new order with auto-assigned order number, current date, calculated order total,
// and auto-incremented line_item_ids
app.post('/orders', (req, res) => {
  const orders = loadOrders();
  const newOrderData = req.body;

  // Auto-generate order_id by incrementing the max order number
  let maxOrderId = orders.reduce((max, order) => Math.max(max, parseInt(order.order_id, 10)), 0);
  const newOrderId = (maxOrderId + 1).toString();

  // Set the order_date to the current date/time
  const currentDate = new Date().toISOString();

  // Calculate the order_total based on the line_items price sum
  const orderTotal = newOrderData.line_items.reduce((total, item) => total + (item.price || 0), 0);

  // Calculate the current maximum line_item_id across all orders
  let maxLineItemId = orders.reduce((max, order) => {
    const orderMax = (order.line_items || []).reduce((maxItem, li) => {
      // Expecting line_item_id in the format "LI-<number>"
      const num = li.line_item_id ? parseInt(li.line_item_id.replace('LI-', ''), 10) : 0;
      return Math.max(maxItem, num);
    }, 0);
    return Math.max(max, orderMax);
  }, 0);

  // Auto-assign line_item_id for each line item that doesn't have one
  const newLineItems = newOrderData.line_items.map(item => {
    if (!item.line_item_id) {
      maxLineItemId++;
      return { ...item, line_item_id: `LI-${maxLineItemId}` };
    }
    return item;
  });

  // Build the new order object
  const newOrder = {
    order_id: newOrderId,
    order_total: orderTotal,
    order_date: currentDate,
    shipping_address: newOrderData.shipping_address,
    customer_name: newOrderData.customer_name,
    customer_email: newOrderData.customer_email,
    line_items: newLineItems
  };

  orders.push(newOrder);
  saveOrders(orders);
  res.status(201).json(newOrder);
});

// Update an existing order by order_id
app.put('/orders/:orderId', (req, res) => {
  const orders = loadOrders();
  const index = orders.findIndex(o => o.order_id === req.params.orderId);
  if (index === -1) {
    return res.status(404).json({ message: 'Order not found' });
  }
  orders[index] = { ...orders[index], ...req.body };
  saveOrders(orders);
  res.json(orders[index]);
});

// Delete an order by order_id
app.delete('/orders/:orderId', (req, res) => {
  let orders = loadOrders();
  const index = orders.findIndex(o => o.order_id === req.params.orderId);
  if (index === -1) {
    return res.status(404).json({ message: 'Order not found' });
  }
  const deletedOrder = orders.splice(index, 1)[0];
  saveOrders(orders);
  res.json(deletedOrder);
});

//
// Picking Endpoint: Aggregates all individual products needed from all orders.
//
app.get('/picking', (req, res) => {
  const orders = loadOrders();
  const aggregated = {};

  orders.forEach(order => {
    (order.line_items || []).forEach(lineItem => {
      const mapping = productMapping[lineItem.product_id];
      if (mapping && mapping.products) {
        mapping.products.forEach(product => {
          aggregated[product.product_name] = (aggregated[product.product_name] || 0) + 1;
        });
      }
    });
  });

  // Convert the aggregated object to an array for response clarity
  const pickingList = Object.entries(aggregated).map(([productName, quantity]) => ({
    product_name: productName,
    quantity
  }));

  res.json(pickingList);
});

//
// Packing Endpoint: Returns orders with each gift box broken down into its individual products.
//
app.get('/packing', (req, res) => {
  const orders = loadOrders();
  const detailedOrders = orders.map(order => {
    const detailedLineItems = (order.line_items || []).map(lineItem => {
      const mapping = productMapping[lineItem.product_id];
      return {
        ...lineItem,
        products: mapping ? mapping.products : []
      };
    });
    return { ...order, line_items: detailedLineItems };
  });
  res.json(detailedOrders);
});

//
// Start the Server
//
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Warehouse API server listening on port ${PORT}`);
});
