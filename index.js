require('dotenv').config()
const express = require('express')
const cors = require('cors')
const cookieParser = require('cookie-parser')
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb')
const jwt = require('jsonwebtoken')

const port = process.env.PORT || 3000
const app = express()
// middleware
const corsOptions = {
  origin: ['http://localhost:5173', 'http://localhost:5174'],
  credentials: true,
  optionSuccessStatus: 200,
}
app.use(cors(corsOptions))

app.use(express.json())
app.use(cookieParser())

const verifyToken = async (req, res, next) => {
  const token = req.cookies?.token

  if (!token) {
    return res.status(401).send({ message: 'unauthorized access' })
  }
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      console.log(err)
      return res.status(401).send({ message: 'unauthorized access' })
    }
    req.user = decoded
    next()
  })
}

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(process.env.MONGODB_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
})
async function run() {
  const db = client.db('BloodDB')
  const bloodCollection = db.collection('bloods')
  const donationRequestCollection = db.collection('donationRequests')
  const userCollection = db.collection('users')
   const blogCollection = db.collection('blogs');
   const donorCollection = db.collection('donors');

  try {
    // Generate jwt token
    app.post('/jwt', async (req, res) => {
      const email = req.body
      const token = jwt.sign(email, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: '365d',
      })
      res
        .cookie('token', token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
        })
        .send({ success: true })
    })
    // Logout
    app.get('/logout', async (req, res) => {
      try {
        res
          .clearCookie('token', {
            maxAge: 0,
            secure: process.env.NODE_ENV === 'production',
            sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
          })
          .send({ success: true })
      } catch (err) {
        res.status(500).send(err)
      }
    })

   //save or update a user info in db
    app.post('/user', async(req,res)=>{
      const userData = req.body
      userData.role = 'donor'
      userData.status = 'active'
      userData.created_at = new Date().toISOString()
      userData.last_loggedIn = new Date().toISOString()
      console.log(userData);
      const query = {
        email : userData?.email
      }
      const alreadyExists = await userCollection.findOne(query)

      if(!!alreadyExists){
        console.log('updating user data.......!');
        const result = await userCollection.updateOne({query}, {
          $set : {
            last_loggedIn : new Date().toISOString()
          }
        }
      )
      return res.send(result)
      }
       console.log('creating user data.......!');
      const result = await userCollection.insertOne(userData)
      res.send(result);
    }) 
    
// --- ROUTES ---
//Donor plane

// Get max 3 recent donation requests for logged-in donor
app.get('/requests/recent', verifyToken, async (req, res) => {
  try {
    const email = req.user.email; // coming from JWT token
    const requests = await donationRequestCollection
      .find({ requesterEmail: email })
      .sort({ createdAt: -1 })
      .limit(3)
      .toArray();

    res.send(requests);
  } catch (error) {
    res.status(500).send({ message: 'Failed to fetch donation requests', error });
  }
});


// POST: Create a donation request
app.post('/create-donation-request', async (req, res) => {
  try {
    const request = req.body;
    console.log(request);
    // check if the requester is blocked
    const user = await userCollection.findOne({ email: request.requesterEmail });
    if (!user || user.status === 'blocked') {
      return res.status(403).send({ message: 'Access denied. You are blocked.' });
    }

    // add status = 'pending' by default
    request.status = 'pending';

    const result = await donationRequestCollection.insertOne(request);
    console.log(result);
    res.send(result);
  } catch (err) {
    console.error('Error creating donation request:', err);
    res.status(500).send({ message: 'Server error' });
  }
});

// Update donation request status: only allowed transitions
app.put('/requests/:id/status', verifyToken, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!['done', 'canceled'].includes(status)) {
    return res.status(400).send({ message: 'Invalid status update' });
  }

  try {
    const result = await donationRequestCollection.updateOne(
      { _id: new ObjectId(id), status: 'inprogress' },
      { $set: { status } }
    );

    res.send({ success: result.modifiedCount > 0 });
  } catch (error) {
    res.status(500).send({ message: 'Error updating status', error });
  }
});



// 1. Get 3 recent donation requests for logged-in donor

// ✅ Get all donation requests for logged-in donor
app.get('/donation-requests', verifyToken,  async (req, res) => {
  try {
    const email = req.user.email;
    const status = req.query.status;
    const query = { requesterEmail: email };
    if (status && ['pending', 'inprogress', 'done', 'canceled'].includes(status)) {
      query.donationStatus = status;
    }
    const requests = await donationRequestCollection.find(query).sort({ _id: -1 }).toArray();
    console.log(requests);
    res.send(requests);
  } catch (err) {
    res.status(500).send({ message: 'Failed to fetch donation requests' });
  }
});

// ✅ Get single donation request by ID
app.get('/donation-requests/:id', verifyToken, async (req, res) => {
  try {
    const id = req.params.id;
    const request = await donationRequestCollection.findOne({ _id: new ObjectId(id) });
    if (!request) return res.status(404).send({ message: 'Not found' });
    res.send(request);
  } catch {
    res.status(500).send({ message: 'Error fetching request' });
  }
});

// ✅ Update donation request by ID
app.put('/donation-requests/:id', verifyToken, async (req, res) => {
  try {
    const id = req.params.id;
    const updateData = { ...req.body };
    delete updateData._id; // Prevent trying to modify _id

    const result = await donationRequestCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updateData }
    );

    res.send(result);
  } catch (error) {
    console.error('Error updating request:', error);
    res.status(500).send({ message: 'Update failed' });
  }
});


// ✅ Delete donation request
app.delete('/donation-requests/:id', verifyToken, async (req, res) => {
  try {
    const id = req.params.id;
    const result = await donationRequestCollection.deleteOne({ _id: new ObjectId(id) });
    res.send(result);
  } catch {
    res.status(500).send({ message: 'Delete failed' });
  }
});



//Admin plane



 //1. GET all user
app.get('/users', async (req, res) => {
  try {
    const status = req.query.status || 'all';
    let query = {};
    if (status !== 'all') {
      query.status = status;
    }

    const users = await userCollection.find(query).toArray();
    res.send({ users });
  } catch (err) {
    res.status(500).send({ message: 'Failed to fetch users' });
  }
});

  //user status
  app.patch('/users/:id/status', async (req, res) => {
  try {
    const id = req.params.id;
    const { status } = req.body;

    if (!['active', 'blocked'].includes(status)) {
      return res.status(400).send({ message: 'Invalid status' });
    }

    const result = await userCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { status } }
    );
   res.send(result);
  } catch (err) {
    res.status(500).send({ message: 'Failed to update user status' });
  }
});


//user role status
app.patch('/users/:id/role', async (req, res) => {
  try {
    const id = req.params.id;
    const { role } = req.body;

    if (!['admin', 'volunteer'].includes(role)) {
      return res.status(400).send({ message: 'Invalid role' });
    }

    const result = await userCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { role } }
    );

    res.send(result);
  } catch (err) {
    res.status(500).send({ message: 'Failed to update user role' });
  }
});


 //get user by their role
  app.get('/users/role/:email', async(req,res)=>{
  const email = req.params.email
  console.log(email);
  const filter = {email : email}
  const result = await userCollection.findOne(filter)
  console.log(result);
  if(!result) return res.status(404).send({message: 'User Not Found'})
  res.send({role : result?.role})
  })




  // GET all blogs
app.get('/blogs', async (req, res) => {
  const status = req.query.status || 'all';
  const filter = status === 'all' ? {} : { status };
  const result = await blogCollection.find(filter).sort({ createdAt: -1 }).toArray();
  res.send(result);
});

// POST create new blog
app.post('/blogs', async (req, res) => {
  const blog = {
    title: req.body.title,
    thumbnail: req.body.thumbnail,
    content: req.body.content,
    status: 'draft',
    createdAt: new Date()
  };
  const result = await blogCollection.insertOne(blog);
  res.send(result);
});

// PATCH update status (admin only)
app.patch('/blogs/:id/status', async (req, res) => {
  const id = req.params.id;
  const { status } = req.body;
  const result = await blogCollection.updateOne(
    { _id: new ObjectId(id) },
    { $set: { status } }
  );
  res.send(result);
});

// DELETE blog (admin only)
app.delete('/blogs/:id', async (req, res) => {
  const id = req.params.id;
  const result = await blogCollection.deleteOne({ _id: new ObjectId(id) });
  res.send(result);
});


//Funding plane
//create a fund
app.post('/create-fund',  async (req, res) => {
  const { name, email, amount } = req.body;
  const fund = {
    name,
    email,
    amount,
    date: new Date(),
    status: 'success'
  };
  const result = await fundingCollection.insertOne(fund);
  res.send(result);
});




    


    // Send a ping to confirm a successful connection
    await client.db('admin').command({ ping: 1 })
    console.log(
      'Pinged your deployment. You successfully connected to MongoDB!'
    )
  } finally {
    // Ensures that the client will close when you finish/error
  }
}
run().catch(console.dir)

app.get('/', (req, res) => {
  res.send('Hello from plantNet Server..')
})

app.listen(port, () => {
  console.log(`plantNet is running on port ${port}`)
})
