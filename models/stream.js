/**
 * Stream object for signaling server

 *
 * @author Daniil Makeev / daniil-makeev@yandex.ru
 * @package Stream
 */

var config = require("getconfig");
const crypto = require("crypto");
var Server = require("../server.js");
var Log = require("./log.js");
var User = require("./user.js");
var Result = require("./result.js");

class Stream {
  constructor(data) {
    var self = this;
    self.id = null;
    self.name = null;
    self.presenter = null;
    self.viewer = null;
    self.redisKey = "";
  }

  /**
   * Start presenter's stream
   *
   * @param    data        array       Input params
   * @param    callback    function
   */
  start(userObject, data, callback) {
    var self = this;
    callback = callback ? callback : () => {};
    Server.server.redisClient.get(
      config.redis.lastUsedStreamId,
      (err, lastId) => {
        lastId++;
        Server.server.redisClient.set(config.redis.lastUsedStreamId, lastId);
        self.id = lastId;
        self.hash = crypto.randomBytes(16).toString("hex");
        self.started = new Date();
        self.sdpOffer = data.sdpOffer;
        self.presenter = {
          client: data.client,
          id: userObject.id,
          ip: userObject.ip,
          socket: userObject.socket,
        };
        self.save(() => {
          if (
            typeof userObject.mappingId !== "undefined" &&
            typeof userObject.socket.id !== "undefined"
          ) {
            let mappingId = userObject.mappingId;
            let loggingData = `stream started successfully with mappingId : ${mappingId} \r\n`;
            loggingData += `and socketId : ${userObject.socket.id} \r\n`;

            Log.loggingIntoFile(loggingData, mappingId, "debugLog");
          }

          callback(err, self);
        });
      }
    );
  }

  /**
   * View stream
   *
   * @param    userObject  User
   * @param    callback    function
   */
  view(userObject, callback) {
    var self = this;
    callback = callback ? callback : () => {};
    if (self.viewer) {
      if (
        typeof userObject.mappingId !== "undefined" &&
        typeof userObject.socket.id !== "undefined"
      ) {
        let mappingId = userObject.mappingId;
        let loggingData = `Somebody else is watching this stream now, mappingId : ${mappingId} \r\n`;
        loggingData += `and socketId : ${userObject.socket.id} \r\n`;

        Log.loggingIntoFile(loggingData, mappingId, "debugLog");
      }

      return callback("Somebody else is watching this stream now");
    }
    self.viewer = {
      id: userObject.id,
      ip: userObject.ip,
      socket: userObject.socket,
    };
    self.save((err) => {
      callback(err);
    });
  }

  /**
   * Leave stream
   *
   * @param    userObject  User
   * @param    callback    function
   */
  leave(id, callback) {
    var self = this;
    callback = callback ? callback : () => {};
    self.viewer = null;
    self.save((err) => {
      callback(err);
    });
  }

  /*
   * Subscribe to stream list updates
   *
   * @param    userObject  User
   * @param    callback    function
   */
  observe(userObject, callback) {
    var self = this;
    callback = callback ? callback : () => {};
    Server.server.redisClient.hset(
      config.redis.streamObservers,
      userObject.id,
      userObject.socket
    );
    callback();
  }

  /*
   * Stop receiving stream list updates
   *
   * @param    userObject  User
   * @param    callback    function
   */
  abandon(userObject, callback) {
    var self = this;
    callback = callback ? callback : () => {};
    Server.server.redisClient.hdel(config.redis.streamObservers, userObject.id);
    callback();
  }

  /*
   * Get list of active streams
   *
   * @param    callback    function
   */
  getStreamList(callback) {
    // get observer list
    Server.server.redisClient.hgetall(
      config.redis.streamObservers,
      (err, users) => {
        if (err) {
          return callback(err);
        }
        Server.server.redisClient.hgetall(
          config.redis.streamList,
          (err, streams) => {
            if (err) {
              return callback(err);
            }
            let deepStreams = 0;
            let deepUsers = 0;
            let result = { users: users, streams: {} };
            if (!streams) {
              return callback(null, result);
            }
            for (let i in streams) {
              deepStreams++;
              new Stream().load(streams[i], (err, streamObject) => {
                deepStreams--;
                if (err) {
                  Server.server.redisClient.hdel(
                    config.redis.streamList,
                    streams[i]
                  );
                  if (!deepStreams && !deepUsers) {
                    callback(null, result);
                  }
                } else {
                  deepUsers++;
                  let presenterId =
                    streamObject.presenter && streamObject.presenter.id
                      ? streamObject.presenter.id
                      : null;
                  let viewerId =
                    streamObject.viewer && streamObject.viewer.id
                      ? streamObject.viewer.id
                      : null;
                  new Server.server.userClass().load(
                    presenterId,
                    (err, presenterObject) => {
                      new Server.server.userClass().load(
                        viewerId,
                        (err, viewerObject) => {
                          deepUsers--;
                          let toSend = false;
                          if (!presenterId || !presenterObject) {
                            if (
                              typeof streamObject.presenter.mappingId !==
                              "undefined"
                            ) {
                              let mappingId = streamObject.presenter.mappingId;
                              let loggingData = `Presenter is offline, removing stream, mappingId : ${mappingId} \r\n`;

                              Log.loggingIntoFile(
                                loggingData,
                                mappingId,
                                "debugLog"
                              );
                            }

                            streamObject.delete();
                          } else if (viewerId && !viewerObject) {
                            if (
                              typeof streamObject.viewer.mappingId !==
                              "undefined"
                            ) {
                              let mappingId = streamObject.viewer.mappingId;
                              let loggingData = `Viewer is offline, releasing stream, mappingId : ${mappingId} \r\n`;

                              Log.loggingIntoFile(
                                loggingData,
                                mappingId,
                                "debugLog"
                              );
                            }

                            streamObject.delete();
                            //streamObject.viewer = null;
                            //streamObject.save();
                            // Notify presenter about it
                            Result.emit(
                              { socket: streamObject.presenter.socket },
                              "/v1/stream/leaved",
                              200,
                              { stream: streamObject.id }
                            );
                            //toSend = true;
                          } else {
                            toSend = true;
                          }
                          if (toSend) {
                            result.streams[streamObject.id] = {
                              id: streamObject.id,
                              client: streamObject.presenter.client,
                              started: streamObject.started,
                              presenter: streamObject.presenter,
                              viewer: streamObject.viewer,
                              sdpOffer: streamObject.sdpOffer,
                            };
                          }
                          if (!deepStreams && !deepUsers) {
                            callback(null, result);
                          }
                        }
                      );
                    }
                  );
                }
              });
            }
          }
        );
      }
    );
  }

  /**
   * Generate redis key for actual stream
   *
   */
  getRedisKey() {
    let self = this;
    self.redisKey = "activeStream" + self.id;
  }

  /**
   * Save stream to Redis
   *
   * @param    callback    function
   */
  save(callback) {
    let self = this;
    callback = callback ? callback : () => {};
    if (!self.redisKey) {
      self.getRedisKey();
    }
    var toStore = {};
    for (let i in self) {
      toStore[i] = self[i];
    }
    toStore = JSON.stringify(toStore);
    Server.server.redisClient.set(self.redisKey, toStore, (err) => {
      // Update stream list
      Server.server.redisClient.hset(config.redis.streamList, self.id, self.id);
      callback(err);
    });
  }

  /**
   * Load steam from Redis
   *
   * @param    data        array       Stream data to load (ID)
   * @param    callback    function
   */
  load(id, callback) {
    var self = this;
    // console.log("data", data);
    // If only one parameter set — load actual stream
    if (!callback) {
      callback = id;
      // If data is present - load object according it
    } else if (id && callback) {
      self.id = id;
      self.getRedisKey();
    }
    console.log(`Stream id : ${self.redisKey} \r\n`);
    Server.server.redisClient.get(self.redisKey, (err, data) => {
      console.log(`Stream data ${JSON.parse(data)} \r\n`);
      if (data) {
        data = JSON.parse(data);
        for (let i in data) {
          self[i] = data[i];
        }
        callback(null, self);
      } else {
        console.log(`Stream not found ${self.id} \r\n`);
        Log.loggingIntoFile(`Stream not found ${self.id} \r\n`);

        callback("Stream not found: " + self.id, null);
      }
    });
  }

  /**
   * Delete stream
   *
   * @param    callback    function
   */
  delete(callback) {
    var self = this;
    callback = callback ? callback : () => {};
    if (!self.redisKey) {
      self.getRedisKey();
    }
    Server.server.redisClient.hdel(config.redis.streamList, self.id);
    Server.server.redisClient.del(self.redisKey);
    callback(null);
  }
}

module.exports = Stream;
