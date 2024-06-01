/**
 * Service functions for signaling server
 *
 * @author Daniil Makeev / daniil-makeev@yandex.ru
 * @package Service
 */

var config = require("getconfig");
// Server
var Server = require("../server.js");
// Log
var Log = require("../models/log.js");
// User
var User = require("./user.js");
// Stream
var Stream = require("./stream.js");

class Service {
  constructor() {
    var self = this;
    self.serviceInterval = 10; // in seconds
  }

  /**
   * Schedule service functions
   *
   * @return    object    Service class
   */
  schedule() {
    var self = this;
    if (!Server.server) {
      setTimeout(() => {
        self.schedule();
      }, 300);
      return true;
    }
    setInterval(() => {
      self.removeOldStreams();
    }, 1000);
    return self;
  }

  /**
   * Remove empty streams
   *
   * @return    bool
   */
  removeOldStreams() {
    try {
      // Get all streams
      Server.server.redisClient.hgetall(
        config.redis.streamList,
        (err, data) => {
          if (err) {
            return false;
          }
          for (let i in data) {
            try {
              var item = JSON.parse(data[i]);
            } catch (e) {
              Server.server.redisClient.hdel(config.redis.streamList, i);
              continue;
            }
            // Load stream
            new Stream().load(item, (err, streamObject) => {
              if (err) {
                return Server.server.redisClient.hdel(
                  config.redis.streamList,
                  i
                );
              }
              // If no active users present — remove stream
              if (!streamObject.presenter) {
                Log.loggingIntoFile(
                  "Empty stream " + streamObject.id + " removed" + " \r\n"
                );
                streamObject.delete();
              }
            });
          }
        }
      );
    } catch (e) {
      console.log(e);

      Log.loggingIntoFile(
        "Error in service.removeOldSessions: " + e.message + " \r\n",
        "error"
      );
    }
  }
}

module.exports = new Service();
