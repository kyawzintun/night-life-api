'use strict'

const mongoose = require('mongoose');

module.exports = function () {
  mongoose.connect('mongodb://kyawzintun:test@ds121336.mlab.com:21336/night-life')
  const db = mongoose.connection;
  const UserSchema = mongoose.Schema({
    dispalyname: {
      type: String, required: true
    },
    twitterProvider: {
      type: {
        id: String,
        token: String
      },
      select: false
    }
  });
  UserSchema.set('toJSON', { getters: true, virtuals: true });

  UserSchema.statics.upsertTwitterUser = function (token, tokenSecret, profile, cb) {
    var that = this;
    return this.findOne({
      'twitterProvider.id': profile.id
    }, function (err, user) {
      // no user was found, lets create a new one
      if (!user) {
        var newUser = new that({
          dispalyname: profile.displayName,
          twitterProvider: {
            id: profile.id,
            token: token,
            tokenSecret: tokenSecret
          }
        });

        newUser.save(function (error, savedUser) {
          if (error) {
            console.log(error);
          }
          return cb(error, savedUser);
        });
      } else {
        return cb(err, user);
      }
    });
  };

  const GoingListSchema = mongoose.Schema({
    id: { type: String, required: true },
    userId: { type: Array, required: true },
    numberOfGoers: { type: Number, required: true }
  });
  GoingListSchema.set('autoIndex', false);

  mongoose.model('User', UserSchema);
  mongoose.model('GoingList', GoingListSchema);
  return db;
};