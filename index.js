'use strict'

const express = require('express'),
  app = express(),
  cors = require('cors'),
  bodyParser = require('body-parser'),
  mongoose = require('./src/mongoose'),
  passport = require('passport'),
  jwt = require('jsonwebtoken'),
  expressJwt = require('express-jwt'),
  router = express.Router(),
  request = require('request'),
  twitterConfig = require('./src/twitter.config.js'),
  yelConfig = require('./src/yel.config.js'),
  port = process.env.PORT || 5000;

mongoose();
const User = require('mongoose').model('User');
const GoingList = require('mongoose').model('GoingList');
const passportConfig = require('./src/passport');
passportConfig();

const corsOption = {
  origin: true,
  methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
  credentials: true,
  exposedHeaders: ['x-auth-token']
};
app.use(cors(corsOption));
app.use(bodyParser.urlencoded({
  extended: true
}));
app.use(bodyParser.json());

const createToken = function (auth) {
  return jwt.sign({
    id: auth.id
  }, 'my-secret',
    {
      expiresIn: 60 * 120
    });
};

const generateToken = function (req, res, next) {
  req.token = createToken(req.auth);
  return next();
};

const sendToken = function (req, res) {
  res.setHeader('x-auth-token', req.token);
  return res.status(200).send(JSON.stringify(req.user));
};

router.route('/auth/twitter/reverse')
  .post(function (req, res) {
    request.post({
      url: 'https://api.twitter.com/oauth/request_token',
      oauth: {
        oauth_callback: twitterConfig.tiwtterCallBack,
        consumer_key: twitterConfig.consumerKey,
        consumer_secret: twitterConfig.consumerSecret
      }
    }, function (err, r, body) {
      if (err) {
        return res.send(500, { message: e.message });
      }
      var jsonStr = '{ "' + body.replace(/&/g, '", "').replace(/=/g, '": "') + '"}';
      res.send(JSON.parse(jsonStr));
    });
  });

router.route('/auth/twitter')
  .post((req, res, next) => {
    request.post({
      url: `https://api.twitter.com/oauth/access_token?oauth_verifier`,
      oauth: {
        consumer_key: twitterConfig.consumerKey,
        consumer_secret: twitterConfig.consumerSecret,
        token: req.query.oauth_token
      },
      form: { oauth_verifier: req.query.oauth_verifier }
    }, function (err, r, body) {
      if (err) {
        return res.send(500, { message: err.message });
      }
      const bodyString = '{ "' + body.replace(/&/g, '", "').replace(/=/g, '": "') + '"}';
      const parsedBody = JSON.parse(bodyString);

      req.body['oauth_token'] = parsedBody.oauth_token;
      req.body['oauth_token_secret'] = parsedBody.oauth_token_secret;
      req.body['user_id'] = parsedBody.user_id;

      next();
    });
  }, passport.authenticate('twitter-token', { session: false }), function (req, res, next) {
    if (!req.user) {
      return res.send(401, 'User Not Authenticated');
    }
    // prepare token for API
    req.auth = {
      id: req.user.id
    };
    return next();
  }, generateToken, sendToken);

//token handling middleware
var authenticate = expressJwt({
  secret: 'my-secret',
  requestProperty: 'auth',
  getToken: function (req) {
    if (req.headers['x-auth-token']) {
      return req.headers['x-auth-token'];
    }
    return null;
  }
});

var getCurrentUser = function (req, res, next) {
  User.findById(req.auth.id, function (err, user) {
    if (err) {
      next(err);
    } else {
      req.user = user;
      next();
    }
  });
};

var getOne = function (req, res) {
  var user = req.user.toObject();
  delete user['twitterProvider'];
  delete user['__v'];
  res.json(user);
};

router.route('/auth/me')
  .get(authenticate, getCurrentUser, getOne);

app.use('/api/v1', router);

app.get('/search-bar', (req, res) => {
  let cID = yelConfig.clientID;
  let cSec = yelConfig.clientSecret;
  let authUrl = yelConfig.authUrl+`client_id=${cID}&&client_secret=${cSec}`;
  let url = yelConfig.searchUrl;
  let options = {
    url: url +"term=restaurants&&location="+req.query.keyword,
    method: 'GET',
    headers: {
      "Authorization": `Bearer ${yelConfig.access_token}`
    }
  }
  // let options2 = {
  //   url: authUrl + "client_id=" + yelConfig.clientID + "&&client_secret=" + yelConfig.clientSecret,
  //   method: 'POST',
  // }
  // request(options2, (err, response, body) => {
  //   console.log(body, response);
  // });
  request(options, (err, response, body) => {
    if(!err) {
      let resBody = JSON.parse(body);
      let count = 0;
      let lists = [];
      GoingList
      .find()
      .select({ numberOfGoers: 1, id: 2 })
      .then(docs => {
        resBody.businesses.forEach((rest, index) => {
          docs.forEach(doc => {
            if (rest.id !== doc.id) {
              if(!rest.hasOwnProperty("numberOfGoers")){
                rest["numberOfGoers"] = 0;
              }
            } else {
              resBody.businesses[index]["numberOfGoers"] = doc.numberOfGoers;
            }
          });
          count++;
          if (count === resBody.businesses.length) {
            res.status(200).json(resBody);
          }
        });
      })
      .catch(err => {
        res.status(500).send('Internal Server Error');
      });
    }else {
      console.log(err, 'auth err');
      res.status(500).send('Yel API Auth Error');
    }
  })  
});

app.post('/add-going-list', isAuthenticated, (req, res) => {
  let userId = req.headers.token;
  GoingList.find({id:req.body.id}, function (err, gointlist) {
    if (!gointlist.length) {
      let userObj = {
        id: userId,
        date: new Date().toISOString()
      }
      req.body.numberOfGoers = 1;
      req.body.userId= [userObj];
      insertNewGoingList(req.body)
        .then(inserted => {
          if (!inserted) {
            res.status(500).send('Unknown error');
          } else {
            res.status(200).json({ numberOfGoers: 1, message: 'Successfully added to going list.' });
          }
        })
        .catch(err => {
          res.status(500).send('Internal Server Error');
        });
    } else {
      let list = gointlist[0];
      let addedGoingList = 0;
      let msg = '';
      let index = list.userId.map((x) => { return x.id; }).indexOf(userId)
      if(index !== -1) {
        addedGoingList = list.numberOfGoers - 1;
        list.userId.splice(index, 1);
        msg = 'Successfully removed from going list';
      }else {
        msg = "Successfully added to going list.";
        addedGoingList = list.numberOfGoers + 1
        list.userId.push({id: userId, date: new Date().toISOString()})
      }
      GoingList.update(
        { _id: list._id }, 
        { numberOfGoers: addedGoingList, userId: list.userId }, 
        function (err, updated) {
          if (err) {
            res.status(500).send("Internal Server Error.");
          } else {
            res.status(200).json({ numberOfGoers: addedGoingList, message: msg });
          }
      });
    }
  });
});

function insertNewGoingList(goingObj) {
  let going_lsit = new GoingList(goingObj);
  return going_lsit.save();
}

function parseJwt(token, res) {
  if (token && token.length === 171) {
    let base64Url = token.split('.')[1];
    let base64 = base64Url.replace('-', '+').replace('_', '/');
    return JSON.parse(Buffer.from(base64, 'base64').toString());
  }
  return res.status(401).send("User Not Authenticated");
};

function isAuthenticated(req, res, next) {
  if (req.headers.token !== 'undefined') {
    let decode = parseJwt(req.headers.token, res);
    User.findById(decode.id, function (err, user) {
      if (err) {
        return res.status(401).send("User Not Authenticated");
      } else {
        next();
      }
    });
  }else {
    res.status(401).send("Token is required.");
  }
  
}

app.listen(port, () => {
  console.log('app is running on port ', port);
});