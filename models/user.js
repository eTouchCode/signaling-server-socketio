/**
 * User object for signaling server

 *
 * @author Daniil Makeev / daniil-makeev@yandex.ru
 * @package User
 */

var config = require("getconfig");
const crypto = require("crypto");
var fs = require("fs");
var Server = require("../server.js");
var Log = require("./log.js");
var Stream = require("./stream.js");

class User {
  constructor() {
    var self = this;
    self.id = null;
    //self.clientId = null;
    self.active = false;
    self.redisKey = null;
    self.device = null;
    self.redisKey = null;
    self.mappingId = null;
  }

  /**
   * Create a new user by his socket
   *
   * @param    socket        object       socket object
   * @param    callback  function
   */
  create(socket, callback) {
    var self = this;
    self.id = socket.id;
    self.ip = socket.handshake.address;
    self.socket = socket.id;
    self.active = true;
    self.authorized = false;
    self.mappingId = socket.handshake.query.mappingId;
    // Create user's device
    self.device = {
      socket: socket.id,
      device: crypto.randomBytes(16).toString("hex"), // Generate unique device ID. Can be passed as param from device
      ip: socket.handshake.address, // IP
      active: true,
      mappingId: self.mappingId, // device mappingId
    };
    self.save(() => {
      callback(self);
    });
  }

  /**
   * Login
   *
   * @param    data      user credentials
   * @param    callback  function
   */
  login(data, callback) {
    var self = this;
    //
    // Place any login logic here
    //
    //
    let userAuthoried = true;
    if (!userAuthoried) {
      return callback(err);
    }
    self.load((err) => {
      if (err) {
        return callback(err);
      }
      self.authorized = true;
      self.save(() => {
        callback(self);
      });
    });
  }

  /**
   * Logout
   *
   * @param    callback  function
   */
  logout(callback) {
    var self = this;
    //
    // Place any logout logic here
    //
    //
    self.load((err) => {
      if (err) {
        return callback(err);
      }
      self.authorized = false;
      self.save(() => {
        callback(self);
      });
    });
  }

  /**
   * User disconnected
   *
   * @param    callback  function
   */
  onDisconnect(callback) {
    var self = this;
    if (
      typeof self.mappingId !== "undefined" &&
      typeof self.id !== "undefined"
    ) {
      let mappingId = self.mappingId;

      let loggingData = `User disconnected succesfully with mappingId : ${mappingId} \r\n`;

      loggingData += `and socketId : ${self.id} \r\n`;

      Log.loggingIntoFile(loggingData, mappingId, "debugLog");
      Log.loggingIntoFile(loggingData, self.id, "sessions");
    }

    callback = callback ? callback : () => {};

    if (!self.id) {
      return false;
    }
    new Stream().abandon(self);
    self.delete((err) => {
      callback(err);
    });
  }

  /**
   * If user can stream
   *
   * @param    data      stream data
   * @param    callback  function
   */
  isStreamingPossible(data, callback) {
    var self = this;
    return callback();
  }

  /**
   * Generate Redis key for actual user
   *
   */
  getRedisKey() {
    var self = this;
    self.redisKey = self.id ? "authUser_" + self.id : false;
  }

  /**
   * Save user to Redis
   *
   * @param    callback  function
   */
  save(callback) {
    var self = this;
    callback = callback ? callback : () => {};
    if (!self.id) {
      return callback("No user ID set");
    }
    if (!self.redisKey) {
      self.getRedisKey();
    }
    var toStore = {};
    for (let i in self) {
      if (i == "redisKey" || i == "device") {
        continue;
      }
      toStore[i] = self[i];
    }
    toStore = JSON.stringify(toStore);
    if (
      typeof self.mappingId !== "undefined" &&
      typeof self.id !== "undefined"
    ) {
      let mappingId = self.mappingId;

      let loggingData = `save current user with mappingId : ${mappingId} \r\n`;

      loggingData += `and socketId : ${self.id} \r\n`;

      Log.loggingIntoFile(loggingData, mappingId, "debugLog");
    }

    Server.server.redisClient.set(self.redisKey, toStore, (err) => {
      // Update stream list
      Server.server.redisClient.hset(config.redis.userList, self.id, self.id);
      callback(err);
    });
  }

  /**
   * Load user from Redis
   *
   * @param    id          int        User ID to load
   * @param    callback    function
   */
  load(id, callback) {
    var self = this;
    // If only one parameter added — load actual user
    if (!callback) {
      callback = id;
      // In other case load user with specified ID
    } else if (id && callback) {
      self.id = id;
      self.getRedisKey();
    }
    callback = callback ? callback : () => {};
    if (!self.id) {
      return callback("Can`t load user", self);
    }
    if (!self.redisKey) {
      self.getRedisKey();
    }
    Server.server.redisClient.get(self.redisKey, (error, data) => {
      if (data) {
        try {
          data = JSON.parse(data);
        } catch (e) {
          var message = e.message ? e.message : e;
          if (
            typeof self.mappingId !== "undefined" &&
            typeof self.id !== "undefined"
          ) {
            let mappingId = self.mappingId;

            let loggingData = `load user error : ${JSON.stringify(
              e
            )} with mappingId : ${mappingId} \r\n`;

            loggingData += `and socketId : ${self.id} \r\n`;

            Log.loggingIntoFile(loggingData, mappingId, "debugLog");
            Log.loggingIntoFile(loggingData, self.id, "sessions");
          }

          Log.loggingIntoFile("load user error " + message + "  \r\n", "error");
          return callback(message, null);
        }
        if (data) {
          for (let i in data) {
            self[i] = data[i];
          }
          return callback(null, self);
        } else {
          if (
            typeof self.mappingId !== "undefined" &&
            typeof self.id !== "undefined"
          ) {
            let mappingId = self.mappingId;

            let loggingData = `Error parsing user from redis with mappingId : ${mappingId} \r\n`;

            loggingData += `and socketId : ${self.id} \r\n`;

            Log.loggingIntoFile(loggingData, mappingId, "debugLog");
            Log.loggingIntoFile(loggingData, self.id, "sessions");
            Log.loggingIntoFile(
              "Error parsing user from redis : " + self.id + "  \r\n",
              "error"
            );
          }

          callback("Error parsing user from redis: " + self.id, null);
        }
      } else {
        if (
          typeof self.mappingId !== "undefined" &&
          typeof self.id !== "undefined"
        ) {
          let mappingId = self.mappingId;

          let loggingData = `Error User not found with mappingId : ${mappingId} \r\n`;

          loggingData += `and socketId : ${self.id} \r\n`;

          Log.loggingIntoFile(loggingData, mappingId, "debugLog");
        }

        callback("User not found: " + self.id, null);
      }
    });
  }

  /**
   * Delete user from Redis
   *
   * @param    id          int        User ID to load
   */
  delete(id) {
    var self = this;
    if (!id) {
      id = self.id;
    }
    if (!id) {
      if (
        typeof self.mappingId !== "undefined" &&
        typeof self.id !== "undefined"
      ) {
        let mappingId = self.mappingId;

        let loggingData = `Can't delete user with mappingId : ${mappingId} \r\n`;

        loggingData += `and socketId : ${self.id} \r\n`;

        Log.loggingIntoFile(loggingData, mappingId, "debugLog");
      }

      //Log.message('Can`t delete user: ' + id);
      return false;
    }
    if (!self.getRedisKey) {
      self.getRedisKey();
    }
    Server.server.redisClient.hdel(config.redis.streamObservers, id);
    Server.server.redisClient.hdel(config.redis.userList, id);
    Server.server.redisClient.del(self.redisKey);
    if (
      typeof self.mappingId !== "undefined" &&
      typeof self.id !== "undefined"
    ) {
      let mappingId = self.mappingId;

      let loggingData = `user deleted successfully id : ${id} mappingId : ${mappingId} \r\n`;

      loggingData += `and socketId : ${self.id} \r\n`;

      Log.loggingIntoFile(loggingData, mappingId, "debugLog");
    }
  }
}

module.exports = User;
