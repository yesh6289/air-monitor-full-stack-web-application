const express = require('express');
const bodyParser = require('body-parser');
const admin = require('firebase-admin');
const path = require('path');
const request = require('request');
const passwordHash = require('password-hash');
const session = require('express-session');

const app = express();

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const serviceAccount = require('./key.json');

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const db = getFirestore();

app.use(session({
    secret: 'yourSecretKey',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false } // Set to true if using HTTPS
}));

app.set('view engine', 'ejs');

app.get('/', (req, res) => {
    res.render('home');
});

// Login route
app.post('/loginSubmit', async (req, res) => {
    const { email, password } = req.body;

    try {
        if (!email || !password) {
            return res.status(400).send('Email and password are required.');
        }

        const usersData = await db.collection('users')
            .where('email', '==', email)
            .get();

        let verified = false;
        let user = null;

        usersData.forEach((doc) => {
            if (passwordHash.verify(password, doc.data().password)) {
                verified = true;
                user = doc.data();
            }
        });

        if (verified) {
            // Save user info in session
            req.session.user = user;
            // Redirect to dashboard upon successful login
            res.redirect('/dashboard');
        } else {
            res.send('Login failed...');
        }
    } catch (error) {
        console.error('Error during login:', error);
        res.send('Something went wrong...');
    }
});

// Signup route
app.post('/signupSubmit', async (req, res) => {
    const { username, email, password, confirmPassword } = req.body;

    if (password !== confirmPassword) {
        return res.send('Passwords do not match. Please try again.');
    }

    try {
        const usersData = await db.collection('users')
            .where('email', '==', email)
            .get();

        if (!usersData.empty) {
            return res.send('SORRY!!! This account already exists...');
        }

        await db.collection('users').add({
            userName: username,
            email: email,
            password: passwordHash.generate(password)
        });

        res.sendFile(path.join(__dirname, 'public', 'login.html'));
    } catch (error) {
        console.error('Error during signup:', error);
        res.send('Something went wrong...');
    }
});

// Dashboard route
app.get('/dashboard', (req, res) => {
    if (!req.session.user) {
        return res.redirect('/login.html');
    }

    const { userName: username } = req.session.user;
    const pollutants = req.session.pollutants || [];
    const concentrations = req.session.concentrations || [];
    const dangerLevel = req.session.dangerLevel || 'SAFE';

    res.render('dashboard', {
        username: username,
        pollutants: pollutants,
        concentrations: concentrations,
        dangerLevel: dangerLevel
    });
});

// Fetch Air Quality Data Route
app.get('/getAirQuality', (req, res) => {
    const city = req.query.city;

    request.get({
        url: `https://api.api-ninjas.com/v1/airquality?city=${city}`,
        headers: {
            'X-Api-Key': 'Pn0vQimPbXPXVRfrx7Ls1hHJaAQsJufObezT7Kj9'
        },
    }, function(error, response, body) {
        if (error) return res.status(500).json({ error: 'Request failed' });
        else if (response.statusCode != 200) return res.status(response.statusCode).json({ error: 'Error fetching data' });
        else {
            try {
                const airQualityData = JSON.parse(body);
                const pollutants = Object.keys(airQualityData);
                const concentrations = pollutants.map(pollutant => airQualityData[pollutant].concentration);

                const dangerLevel = determineDangerLevel(airQualityData);

                // Store data in session
                req.session.pollutants = pollutants;
                req.session.concentrations = concentrations;
                req.session.dangerLevel = dangerLevel;

                res.json({
                    pollutants: pollutants,
                    concentrations: concentrations,
                    dangerLevel: dangerLevel
                });
            } catch (error) {
                console.error('Error parsing air quality data:', error);
                res.status(500).json({ error: 'Error parsing data' });
            }
        }
    });
});

function determineDangerLevel(airQualityData) {
    const overallAQI = airQualityData.overall_aqi;
    const dangerThreshold = 100;

    if (overallAQI > dangerThreshold) {
        return 'DANGER';
    } else {
        return 'SAFE';
    }
}

app.listen(2000, () => {
    console.log('Server is running on port 2000');
});
