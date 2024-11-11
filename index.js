const express = require('express');
const app = express();

const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const cors = require('cors');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const port = process.env.PORT || 5000;
//middleware
app.use(cors());
app.use(express.json());
//mpngodb connect

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWD}@cluster0.1g0ejju.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;
// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // await client.connect();
    const userCollection = client.db('coffeeWithYouDB').collection('users');
    const menuCollection = client.db('coffeeWithYouDB').collection('menu');
    const reviewsCollection = client
      .db('coffeeWithYouDB')
      .collection('reviews');
    const cartCollection = client.db('coffeeWithYouDB').collection('carts');
    const paymentCollection = client
      .db('coffeeWithYouDB')
      .collection('payment');

    //jwt related api
    app.post('/jwt', async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: '3h',
      });
      res.send({ token });
    });

    //middleware
    const varifyToken = (req, res, next) => {
      // console.log('inside verify token', req.headers.authorization);
      if (!req.headers.authorization) {
        return res.status(401).send({ message: 'forbidden access' });
      }
      const token = req.headers.authorization.split(' ')[1];
      jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err) {
          return res.status(401).send({ message: 'forbidden access' });
        }
        req.decoded = decoded;
        next();
      });
    };
    //use verify admin after verify token {middleware}
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const user = await userCollection.findOne(query);
      const isAdmin = user?.role == 'admin';
      if (!isAdmin) {
        return res.status(403).send({ message: 'is not admin' });
      }
      next();
    };
    //menu related api
    app.get('/menu', async (req, res) => {
      const result = await menuCollection.find().toArray();
      res.send(result);
    });
    app.post('/menu', varifyToken, verifyAdmin, async (req, res) => {
      const item = req.body;
      const result = await menuCollection.insertOne(item);
      res.send(result);
    });
    app.get('/menu/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await menuCollection.findOne(query);
      res.send(result);
    });
    //menu item patch
    app.patch('/menu/:id', async (req, res) => {
      const item = req.body;
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const updatedDoc = {
        $set: {
          name: item.name,
          category: item.category,
          price: item.price,
          recipe: item.recipe,
          image: item.image,
        },
      };
      const result = await menuCollection.updateOne(filter, updatedDoc);
      res.send(result);
    });

    //admin delete item  from menu
    app.delete('/menu/:id', varifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await menuCollection.deleteOne(query);
      res.send(result);
    });

    app.get('/reviews', async (req, res) => {
      const result = await reviewsCollection.find().toArray();
      res.send(result);
    });

    //create users and send to database
    app.post('/users', async (req, res) => {
      const user = req.body;
      //if user does not exits
      //email uniqe
      const query = { email: user.email };
      const existinguser = await userCollection.findOne(query);
      if (existinguser) {
        return res.send({ message: 'User already exist', insertedId: null });
      }
      const result = await userCollection.insertOne(user);
      res.send(result);
    });
    //get all users
    app.get('/users', varifyToken, verifyAdmin, async (req, res) => {
      // console.log(req.headers);
      const result = await userCollection.find().toArray();
      res.send(result);
    });

    //make admin users
    app.patch(
      '/users/admin/:id',
      verifyAdmin,
      varifyToken,
      async (req, res) => {
        const id = req.params.id;
        const filter = { _id: new ObjectId(id) };
        const updatedDoc = {
          $set: {
            role: 'admin',
          },
        };
        const result = await userCollection.updateOne(filter, updatedDoc);
        res.send(result);
      }
    );

    //check email and say isAdmin or not
    app.get('/users/admin/:email', varifyToken, async (req, res) => {
      const email = req.params.email;
      if (email !== req.decoded.email) {
        return res.status(403).send({ message: 'unathorised' });
      }
      const query = { email: email };
      const user = await userCollection.findOne(query);
      let admin = false;
      if (user) {
        admin = user?.role === 'admin';
      }
      res.send({ admin });
    });
    //delete users
    app.delete('/users/:id', verifyAdmin, varifyToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await userCollection.deleteOne(query);
      res.send(result);
    });
    //carts collections
    app.get('/carts', async (req, res) => {
      const email = req.query.email;
      const query = { email: email };
      const result = await cartCollection.find(query).toArray();
      res.send(result);
    });

    app.post('/carts', async (req, res) => {
      const cartItem = req.body;
      const result = await cartCollection.insertOne(cartItem);
      res.send(result);
    });

    //delete item
    app.delete('/carts/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await cartCollection.deleteOne(query);
      res.send(result);
    });

    //payment with stripe
    app.post('/create-payment-intent', async (req, res) => {
      const { price } = req.body;
      const amount = parseInt(price * 100);
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: 'usd',
        payment_method_types: ['card'],
      });
      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    });
    //payment related api
    app.post('/payments', async (req, res) => {
      const payment = req.body;
      const paymentResult = await paymentCollection.insertOne(payment);
      //carefuly delete each id
      const query = {
        _id: {
          $in: payment.cartIds.map((id) => new ObjectId(id)),
        },
      };
      const deleteResult = await cartCollection.deleteMany(query);
      console.log('payment info', payment);
      res.send(paymentResult, deleteResult);
    });

    // await client.db('admin').command({ ping: 1 });
  } finally {
  }
}
run().catch(console.dir);

app.get('/', (req, res) => {
  res.send('Server is running');
});
app.listen(port, () => {
  console.log(`Coffee with you server is on ${port}`);
});
