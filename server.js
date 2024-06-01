/**
 * Signaling server for WebRTC application

 *
 * @author Daniil Makeev / daniil-makeev@yandex.ru
 */

var config = require("getconfig");
var http = require("http");
var fs = require("fs");
var express = require("express");

var io = require("socket.io")({
  allowEIO3: true, // false by default
});
var redis = require("redis");
//const cluster = require('cluster');
//const numCPUs = require('os').cpus().length;
var sticky = require("sticky-session");
const redisAdapter = require("socket.io-redis");
var Redlock = require("redlock");

// User model
var User = require("./models/user.js");
// Result for socket.io requests
var Result = require("./models/result.js");
// Service functions
var Service = require("./models/service.js");
// Signaling server
var Signaling = require("./models/signaling.js");
// Log
var Log = require("./models/log.js");
var User = require("./models/user.js");
// Service functions
var Utils = require("./models/utils.js");
class Server {
  constructor() {
    var self = this;
    self.countRadisError = 0;
    // Global variables
    self.iceServers = config.iceServers;
    self.userClass = User;
    // Init Redis
    self.redisClient = redis.createClient({
      host: config.redis.host,
      port: config.redis.port,
    });
    self.redisClient.select(1);
    self.redlock = new Redlock([self.redisClient], {
      driftFactor: 0.01,
      retryCount: 50,
      retryDelay: 200,
      retryJitter: 200,
    });

    // Init socket listener
    /*let credentials = {
      key: fs.readFileSync(config.server.key, "utf8"),
      cert: fs.readFileSync(config.server.cert, "utf8"),
      ca: fs.readFileSync(config.server.ca, "utf8"),
    };*/
    self.app = express();
    // self.httpServer = http.createServer(credentials, self.app);
    self.httpServer = http.createServer(self.app);
    self.io = require("socket.io")({
      allowEIO3: true, // false by default
    });
    self.io.adapter(
      redisAdapter({ host: config.redis.host, port: config.redis.port })
    );

    // self.io.set("origins", "*:*");
    // Custom middleware for CORS
    self.io.use((socket, next) => {
      let handshakeData = socket.request;
      let origin = socket.handshake.headers.origin;

      Log.loggingIntoFile(`Scoket CORS Block origin : ${origin}  \r\n`);

      // make sure the handshake data looks good as before
      // if error do this:
      // next(new Error("not authorized"));
      // else just call next
      next();
    });
    //self.redisClient = self.io.of('/').adapter;

    // Init signaling server
    self.signaling = new Signaling();

    // Master code
    if (!sticky.listen(self.httpServer, config.server.port)) {
      self.redisClient.flushall();

      // Serve redis disconnects
      self.redisClient.on("error", (error) => {
        Log.loggingIntoFile(
          "Can`t connect to Redis: " + error + "  \r\n",
          "error"
        );
      });
      self.redisClient.on("connect", (message) => {
        Log.loggingIntoFile("Connected to Redis \r\n");
      });
      self.httpServer.once("listening", () => {
        console.log("Server started on " + config.server.port + " port");
      });

      // Start scheduling service
      Service.schedule();
      // Start setvice signaling functions
      self.signaling.serviceFunction();

      Log.loggingIntoFile(
        "Server started at " + config.server.port + " port  \r\n"
      );

      // Worker code
    } else {
      // SOcket listener with separating REST and socket requests
      self.io.listen(self.httpServer);

      // Socket connection
      self.io.sockets.on("connection", (socket) => {
        console.log("connecting");
        if (typeof socket !== "undefined" && typeof socket.id !== "undefined") {
          let loggingData = `Connection Created with socketId : ${socket.id} \r\n`;

          Log.loggingIntoFile(loggingData);
          loggingData = `Session started with socketId : ${socket.id} \r\n`;
          Log.loggingIntoFile(loggingData, socket.id, "sessions");
        }
        if (
          typeof socket !== "undefined" &&
          typeof socket.conn.protocol !== "undefined"
        ) {
          let version = socket.conn.protocol; // either 3 or 4
          let loggingData = `Socket.conn.protocol version : ${version} \r\n`;
          Log.loggingIntoFile(loggingData);
        }
        if (typeof socket.handshake.query.mappingId !== "undefined") {
          let loggingData = `Connection created with mappingId : ${socket.handshake.query.mappingId} \r\n`;
          console.log("loggingData", loggingData);
          Log.loggingIntoFile(
            loggingData,
            socket.handshake.query.mappingId,
            "debugLog"
          );
          Log.loggingIntoFile(loggingData);
        }

        socket.on("error", (error) => {
          Result.emit(socket, "/v1/error", 500, { message: error });

          Log.loggingIntoFile(
            "Socket error : " +
              error +
              " and socketId : " +
              socket.handshake.address +
              " \r\n",
            "error"
          );
        });

        self.signaling.init(socket);
      });
      // Log.message("Worker started");
    }

    // Catch all uncatched exceptions
    process.on("uncaughtException", (e) => {
      self.countRadisError += 1;
      let message = e.message ? e.message : e;
      //Log.error(message);
      if (self.countRadisError > 100) {
        console.log(self.countRadisError, message);
        self.countRadisError = 0;
        Utils.webServiceCall(message);
      }
      // console.error("Error message:", e.message);
      // console.error("Stack trace:", e.stack);
      // console.error("Error object:", e);
      let loggingData = "Error message : " + e.message + "  \r\n";
      loggingData += "Stack trace : " + e.stack + "  \r\n";
      loggingData += "Error object : " + e + "  \r\n";

      Log.loggingIntoFile(loggingData, "error");
    });
  }
}

var ServerInstance = new Server();
module.exports.server = ServerInstance;
