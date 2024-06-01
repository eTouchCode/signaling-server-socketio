/**
 * Signaling server unit

 *
 * @author Daniil Makeev / daniil-makeev@yandex.ru
 * @package Signaling
 */

var config = require("getconfig");
var fs = require("fs");
var Server = require("../server.js");
var Log = require("./log.js");
var User = require("./user.js");
var Stream = require("./stream.js");
var Result = require("./result.js");

class Signaling {
  serviceFunction() {
    let self = this;
    setInterval(() => {
      //  console.log("serviceFunction");
      self.streamsList();
    }, 5000);
  }

  init(socket) {
    let self = this;

    if (
      typeof socket.handshake.query.mappingId !== "undefined" &&
      typeof socket.id !== "undefined"
    ) {
      let mappingId = socket.handshake.query.mappingId;

      let loggingData = `init with mappingId : ${mappingId} \r\n`;

      loggingData += `and socketId : ${socket.id} \r\n`;

      Log.loggingIntoFile(loggingData, mappingId, "debugLog");
      Log.loggingIntoFile(loggingData, socket.id, "sessions");
    }

    // Get current user for socket

    new User().create(socket, (currentUser) => {
      // Catch all requests
      socket.use((packet, next) => {
        // Load actual user
        currentUser.load((err, caller) => {
          // Get command from request
          var command = self.getCommand(packet, currentUser);
          if (!command) {
            return true;
          }
          // You can add any authentication check here
          //if (currentUser.authorized || command == 'user/login' || command == 'alive') {
          self.processCommand(currentUser, command, packet, socket);
          //} else {
          //    Result.emit(socket, 'errorMessage', 403, {'message': 'Forbidden'});
          //}
        });
      });

      // Disconnect handler
      socket.on("disconnect", () => {
        currentUser.onDisconnect();
        if (
          typeof currentUser.mappingId !== "undefined" &&
          typeof socket.id !== "undefined"
        ) {
          let dirPath =
            config.logging.dir +
            config.logging.stats.dir +
            currentUser.mappingId +
            "/";
          let mappingId = currentUser.mappingId;

          let loggingData = `User disconnected succesfully with mappingId : ${mappingId} \r\n`;

          loggingData += `and socketId : ${socket.id} \r\n`;

          Log.loggingIntoFile(loggingData, mappingId, "debugLog");
          Log.loggingIntoFile(loggingData, socket.id, "sessions");
          Log.readAllFilesFromDirectory(dirPath, currentUser.mappingId);
        }
      });

      // User is connected and server is ready to receive commands
      if (
        typeof socket.handshake.query.mappingId !== "undefined" &&
        typeof socket.id !== "undefined"
      ) {
        let mappingId = socket.handshake.query.mappingId;

        let loggingData = `init User connected successfully and server is ready to receive commands with mappingId : ${mappingId} \r\n`;

        loggingData += `and socketId : ${socket.id} \r\n`;

        Log.loggingIntoFile(loggingData, mappingId, "debugLog");
        Log.loggingIntoFile(loggingData, socket.id, "sessions");
      }

      Result.emit(socket, "/v1/ready", 200, {
        message: "Ok",
        iceServers: Server.server.iceServers,
      });
    });
  }

  /**
   * Process input command
   *
   * @param    currentUser     Object
   * @param    command         string
   * @param    packet          array       Input data
   * @param    socket          string      Actual socket
   */
  processCommand(currentUser, command, packet, socket) {
    var self = this;
    var mtch;

    // No command — no action
    if (!command) {
      return true;
    }
    if (
      command.toString().trim() != "alive" &&
      command.toString().trim() != "stream/stats"
    ) {
      if (
        typeof currentUser.mappingId !== "undefined" &&
        typeof socket.id !== "undefined"
      ) {
        let mappingId = currentUser.mappingId;
        let loggingData = `ProcessCommand command : ${command} with mappingId : ${mappingId} \r\n`;
        loggingData += `and socketId : ${socket.id} \r\n`;

        Log.loggingIntoFile(loggingData, mappingId, "debugLog");
        Log.loggingIntoFile(loggingData, socket.id, "sessions");
      }
    }
    switch (command) {
      // User functions
      case "user/login":
        return self.login(currentUser, packet[1], socket);
      case "user/logout":
        return self.logout(currentUser, socket);
      case "user/disconnect":
        return self.disconnect(currentUser, socket);
      /*            case 'readyToStream':
            Log.message('signaling.js swicth case : readyToStream id: ' + socket.id, '', currentUser.mappingId, '', 'debugLog');
                            Log.message('signaling.js 94 readyToStream: ' + socket.id);
                            return Result.emit(socket, 'message', 200, { 'type': 'init', 'payload': null, 'from': socket.id });
            
                        case 'message':
                            return self.streamStart(currentUser, packet[1]);*/
      case "user/screen/control":
        return self.screenControl(currentUser, packet[1]);
      // Stream functions
      case "stream/start":
        if (
          typeof currentUser.mappingId !== "undefined" &&
          typeof socket.id !== "undefined"
        ) {
          let mappingId = currentUser.mappingId;
          let loggingData = `swicth case : stream/start with mappingId : ${mappingId} \r\n`;
          loggingData += `and socketId : ${socket.id} \r\n`;

          Log.loggingIntoFile(loggingData, mappingId, "debugLog");
          Log.loggingIntoFile(loggingData, socket.id, "sessions");
        }

        return self.streamStart(currentUser, packet[1]);
      case "stream/destroy":
        return self.streamDestroy(currentUser, packet[1]);
      case "stream/join":
        return self.streamJoin(currentUser, packet[1]);
      case "stream/leave":
        return self.streamLeave(currentUser, packet[1]);
      case "sdp/ice":
        return self.sdp("ice", currentUser, packet[1]);

      // Stream list functions
      case "streams/list":
        return self.streamsList(currentUser);
      case "streams/observe":
        return self.streamsObserve(currentUser);
      case "streams/abandon":
        return self.streamsAbandon(currentUser);
      case "stream/stats":
        return self.streamStats(packet[1]);

      // Service functions
      case "alive":
        return self.alive(currentUser);
      default:
        Result.emit(currentUser, "/v1/error", 500, {
          message: "Unknown command",
        });
    }
  }

  /**
   * User login
   *
   * @param    currentUser     Object
   * @param    data            Array       User data
   * @param    socket          string      Actual socket
   */
  login(currentUser, data, socket) {
    // Actual command
    var command = "/v1/user/login";
    // Generate a result template
    var result = self.makeResult(data);
    // Validate input data
    var valid = self.validate(currentUser, command, data, [
      "login",
      "password",
    ]);
    if (!valid) {
      return false;
    }
    // Authorize user
    currentUser.login(data, (err) => {
      if (err) {
        // User is not authorized
        return Result.emit(currentUser, command, 403, {
          message: "Incorrect login or passed",
        });
      }
      result.stream = streamObject.id;
      result.ip = currentUser.ip;
      self.streamsList(currentUser);
      return Result.emit(currentUser, command, 200, result);
    });
  }

  /**
   * Logout
   *
   * @param    currentUser     Object
   * @param    socket          string      Actual socket
   */
  logout(currentUser, socket) {
    var command = "/v1/user/logout";
    currentUser.logout((err) => {
      if (err) {
        result.message = err;
        return Result.emit(currentUser, command, 500, result);
      }

      Log.loggingIntoFile("User was logged out  \r\n");
      return Result.emit(currentUser, command, 200, { message: "Ok" });
    });
  }

  /**
   * Socket was disconnected
   *
   * @param    currentUser     Object
   * @param    socket          string      Actual socket
   */
  disconnect(currentUser, socket) {
    var command = "/v1/user/disconnect";

    if (
      typeof currentUser.mappingId !== "undefined" &&
      typeof socket.id !== "undefined"
    ) {
      let mappingId = currentUser.mappingId;
      let loggingData = `disconnect User disconnected manually with mappingId : ${mappingId} \r\n`;
      loggingData += `and socketId : ${socket.id} \r\n`;

      Log.loggingIntoFile(loggingData, mappingId, "debugLog");
      Log.loggingIntoFile(loggingData, socket.id, "sessions");
    }

    Result.emit(socket, command, 200, { message: "Ok" });
    currentUser.onDisconnect();
  }

  /*
   * Create stream — presenter sends his data and waits for viewer
   *
   * @param    currentUser     Object
   * @param    database        Array       Input data
   */
  streamStart(currentUser, data) {
    var self = this;
    var command = "/v1/stream/start";
    var result = self.makeResult(data);
    var valid = self.validate(currentUser, command, data, ["sdpOffer"]);

    if (
      typeof currentUser.mappingId !== "undefined" &&
      typeof currentUser.id !== "undefined"
    ) {
      let mappingId = currentUser.mappingId;
      let loggingData = `streamStart with mappingId : ${mappingId} \r\n`;
      loggingData += `and socketId : ${currentUser.id} \r\n`;

      Log.loggingIntoFile(loggingData, mappingId, "debugLog");
      Log.loggingIntoFile(loggingData, currentUser.id, "sessions");
    }

    if (!valid) {
      return false;
    }
    // Check if user can stream
    currentUser.isStreamingPossible(data, (err) => {
      if (err) {
        if (
          typeof currentUser.mappingId !== "undefined" &&
          typeof currentUser.id !== "undefined"
        ) {
          let mappingId = currentUser.mappingId;
          let loggingData = `streamStart error ${JSON.stringify(
            err
          )} with mappingId : ${mappingId} \r\n`;
          loggingData += `and socketId : ${currentUser.id} \r\n`;

          Log.loggingIntoFile(loggingData, mappingId, "debugLog");
          Log.loggingIntoFile(loggingData, currentUser.id, "sessions");
        }

        result.message = err;
        return Result.emit(currentUser, command, 403, result);
      }
      // Start stream
      new Stream().start(currentUser, data, (err, streamObject) => {
        result.stream = streamObject.id;
        result.ip = currentUser.ip;
        Result.emit(currentUser, command, 200, result);

        if (
          typeof currentUser.mappingId !== "undefined" &&
          typeof currentUser.id !== "undefined"
        ) {
          let mappingId = currentUser.mappingId;
          let loggingData = `streamStart command ${JSON.stringify(
            command
          )} with mappingId : ${mappingId} \r\n`;
          loggingData += `and socketId : ${currentUser.id} \r\n`;

          Log.loggingIntoFile(loggingData, mappingId, "debugLog");
          Log.loggingIntoFile(loggingData, currentUser.id, "sessions");
        }

        // Notify all authorized users
        self.streamsList(currentUser);
      });
    });
  }

  /*
   * Destroy stream
   *
   * @param    currentUser     Object
   * @param    database        array       Input data
   */
  streamDestroy(currentUser, data) {
    var self = this;
    var command = "/v1/stream/destroy";
    var result = self.makeResult(data);
    var valid = self.validate(currentUser, command, data, ["stream"]);
    if (
      typeof currentUser.mappingId !== "undefined" &&
      typeof currentUser.id !== "undefined"
    ) {
      let mappingId = currentUser.mappingId;
      let loggingData = `streamDestroy successfully with mappingId : ${mappingId} \r\n`;
      loggingData += `and socketId : ${currentUser.id} \r\n`;

      Log.loggingIntoFile(loggingData, mappingId, "debugLog");
      Log.loggingIntoFile(loggingData, currentUser.id, "sessions");
    }
    if (!valid) {
      return false;
    }
    new Stream().load(data.stream, (err, streamObject) => {
      if (err) {
        result.message = err;

        if (
          typeof currentUser.mappingId !== "undefined" &&
          typeof currentUser.id !== "undefined"
        ) {
          let mappingId = currentUser.mappingId;
          let loggingData = `streamDestroy error : ${JSON.stringify(
            err
          )} with mappingId : ${mappingId} \r\n`;
          loggingData += `and socketId : ${currentUser.id} \r\n`;

          Log.loggingIntoFile(loggingData, mappingId, "debugLog");
          Log.loggingIntoFile(loggingData, currentUser.id, "sessions");
        }

        return Result.emit(currentUser, command, 500, result);
      }

      Result.emit(currentUser, command, 200, result);
      // Notify viewer that stream is destroyed
      if (streamObject.viewer) {
        Result.emit(
          { socket: streamObject.viewer.socket },
          "/v1/stream/destroyed",
          200,
          result
        );
      }
      streamObject.delete((err) => {
        // Notify all authorized users
        self.streamsList(currentUser);
      });
    });
  }

  /*
   * Join to the stream
   *
   * @param    currentUser     Object
   * @param    data            array       Input data
   */
  streamJoin(currentUser, data) {
    var self = this;
    var command = "/v1/stream/join";
    var result = self.makeResult(data);
    var valid = self.validate(currentUser, command, data, [
      "stream",
      "sdpAnswer",
    ]);
    if (
      typeof currentUser.mappingId !== "undefined" &&
      typeof currentUser.id !== "undefined"
    ) {
      let mappingId = currentUser.mappingId;
      let loggingData = `streamJoin successfully with mappingId : ${mappingId} \r\n`;
      loggingData += `and socketId : ${currentUser.id} \r\n`;

      Log.loggingIntoFile(loggingData, mappingId, "debugLog");
      Log.loggingIntoFile(loggingData, currentUser.id, "sessions");
    }

    if (!valid) {
      return false;
    }
    new Stream().load(data.stream, (err, streamObject) => {
      if (err) {
        if (
          typeof currentUser.mappingId !== "undefined" &&
          typeof currentUser.id !== "undefined"
        ) {
          let mappingId = currentUser.mappingId;
          let loggingData = `streamJoin error : ${JSON.stringify(
            err
          )} with mappingId : ${mappingId} \r\n`;
          loggingData += `and socketId : ${currentUser.id} \r\n`;

          Log.loggingIntoFile(loggingData, mappingId, "debugLog");
          Log.loggingIntoFile(loggingData, currentUser.id, "sessions");
        }

        Result.emit(currentUser, command, 200, result);
        return false;
      }
      streamObject.view(currentUser, (err) => {
        if (err) {
          if (
            typeof currentUser.mappingId !== "undefined" &&
            typeof currentUser.id !== "undefined"
          ) {
            let mappingId = currentUser.mappingId;
            let loggingData = `streamJoin view error : ${JSON.stringify(
              err
            )} with mappingId : ${mappingId} \r\n`;
            loggingData += `and socketId : ${currentUser.id} \r\n`;

            Log.loggingIntoFile(loggingData, mappingId, "debugLog");
            Log.loggingIntoFile(loggingData, currentUser.id, "sessions");
          }

          result.message = err;
          return Result.emit(currentUser, command, 500, result);
        }
        Result.emit(currentUser, command, 200, result);
        result.sdpAnswer = data.sdpAnswer;
        result.viewer = {
          id: currentUser.id,
          name: currentUser.name,
          socket: currentUser.socket,
        };
        if (
          typeof currentUser.mappingId !== "undefined" &&
          typeof currentUser.id !== "undefined"
        ) {
          let mappingId = currentUser.mappingId;
          let loggingData = `streamJoin SUCCESS : ${JSON.stringify(
            streamObject.presenter.socket
          )} with mappingId : ${mappingId} \r\n`;
          loggingData += `and socketId : ${currentUser.id} \r\n`;

          Log.loggingIntoFile(loggingData, mappingId, "debugLog");
          Log.loggingIntoFile(loggingData, currentUser.id, "sessions");
        }

        Result.emit(
          { socket: streamObject.presenter.socket },
          "/v1/stream/joined",
          200,
          result
        );
        // Notify all authorized users
        self.streamsList(currentUser);
      });
    });
  }

  /*
   * Stop watching the stream
   *
   * @param    currentUser     Object
   * @param    database        array       Input data
   */
  streamLeave(currentUser, data) {
    var self = this;
    var command = "/v1/stream/leave";
    var result = self.makeResult(data);
    var valid = self.validate(currentUser, command, data, ["stream"]);

    if (
      typeof currentUser.mappingId !== "undefined" &&
      typeof currentUser.id !== "undefined"
    ) {
      let mappingId = currentUser.mappingId;
      let loggingData = `streamLeave with mappingId : ${mappingId} \r\n`;
      loggingData += `and socketId : ${currentUser.id} \r\n`;

      Log.loggingIntoFile(loggingData, mappingId, "debugLog");
      Log.loggingIntoFile(loggingData, currentUser.id, "sessions");
    }

    if (!valid) {
      return false;
    }
    new Stream().load(data.stream, (err, streamObject) => {
      if (err) {
        if (
          typeof currentUser.mappingId !== "undefined" &&
          typeof currentUser.id !== "undefined"
        ) {
          let mappingId = currentUser.mappingId;
          let loggingData = `streamLeave load error : ${JSON.stringify(
            err
          )} with mappingId : ${mappingId} \r\n`;
          loggingData += `and socketId : ${currentUser.id} \r\n`;

          Log.loggingIntoFile(loggingData, mappingId, "debugLog");
          Log.loggingIntoFile(loggingData, currentUser.id, "sessions");
        }

        Result.emit(currentUser, command, 200, result);
        return false;
      }
      streamObject.leave(currentUser, (err) => {
        if (err) {
          result.message = err;
          if (
            typeof currentUser.mappingId !== "undefined" &&
            typeof currentUser.id !== "undefined"
          ) {
            let mappingId = currentUser.mappingId;
            let loggingData = `streamLeave error : ${JSON.stringify(
              err
            )} with mappingId : ${mappingId} \r\n`;
            loggingData += `and socketId : ${currentUser.id} \r\n`;

            Log.loggingIntoFile(loggingData, mappingId, "debugLog");
            Log.loggingIntoFile(loggingData, currentUser.id, "sessions");
          }

          return Result.emit(currentUser, command, 500, result);
        }
        Result.emit(
          { socket: streamObject.presenter.socket },
          "/v1/stream/leaved",
          200,
          result
        );
        if (
          typeof currentUser.mappingId !== "undefined" &&
          typeof currentUser.id !== "undefined"
        ) {
          let mappingId = currentUser.mappingId;
          let loggingData = `streamLeave COMMAND : ${command} with mappingId : ${mappingId} \r\n`;
          loggingData += `and socketId : ${currentUser.id} \r\n`;

          Log.loggingIntoFile(loggingData, mappingId, "debugLog");
          Log.loggingIntoFile(loggingData, currentUser.id, "sessions");
        }

        Result.emit(currentUser, command, 200, result);
        // Notify all authorized users
        streamObject.delete(() => {
          self.streamsList(currentUser);
        });
      });
    });
  }

  /*
   * SDP message
   *
   * @param    type            string      Command type: offer | answer | ice
   * @param    currentUser     Object
   * @param    database        array       Input data
   */
  sdp(type, currentUser, data) {
    var self = this;
    var command = "/v1/sdp/" + type;
    var result = self.makeResult(data);
    var valid = self.validate(currentUser, command, data, ["stream"]);
    if (!valid) {
      return false;
    }
    new Stream().load(data.stream, (err, streamObject) => {
      if (err) {
        if (
          typeof currentUser.mappingId !== "undefined" &&
          typeof currentUser.id !== "undefined"
        ) {
          let mappingId = currentUser.mappingId;
          let loggingData = `sdp error : ${JSON.stringify(
            err
          )} with mappingId : ${mappingId} \r\n`;
          loggingData += `and socketId : ${currentUser.id} \r\n`;

          Log.loggingIntoFile(loggingData, mappingId, "debugLog");
          Log.loggingIntoFile(loggingData, currentUser.id, "sessions");
        }

        result.message = err;
        return Result.emit(currentUser, command, 404, result);
      }
      switch (type) {
        case "ice":
          result.message = data.message;
          if (
            streamObject.presenter &&
            currentUser.socket == streamObject.presenter.socket
          ) {
            Result.emit(
              { socket: streamObject.presenter.socket },
              command,
              200,
              result
            );
            Result.emit(
              { socket: streamObject.viewer.socket },
              "/v1/sdp/peer_ice",
              200,
              result
            );
          } else if (
            streamObject.viewer &&
            currentUser.socket == streamObject.viewer.socket
          ) {
            Result.emit(
              { socket: streamObject.viewer.socket },
              command,
              200,
              result
            );
            Result.emit(
              { socket: streamObject.presenter.socket },
              "/v1/sdp/peer_ice",
              200,
              result
            );
          } else {
            // Somebody is missing in a call? Strange
            console.log("-*********************************");
            console.log(currentUser.id);
            console.log(streamObject);
          }
          break;
      }
    });
  }

  /*
   * Admin: get list of streams — once
   *
   * @param    currentUser     Object
   */
  streamsList(currentUser) {
    var self = this;
    var command = "/v1/streams/list";
    // console.log("streamsList called");
    new Stream().getStreamList((err, response) => {
      if (err) {
        if (
          typeof currentUser.mappingId !== "undefined" &&
          typeof currentUser.id !== "undefined"
        ) {
          let mappingId = currentUser.mappingId;
          let loggingData = `streamsList error : ${JSON.stringify(
            err
          )} with mappingId : ${mappingId} \r\n`;
          loggingData += `and socketId : ${currentUser.id} \r\n`;

          Log.loggingIntoFile(loggingData, mappingId, "debugLog");
          Log.loggingIntoFile(loggingData, currentUser.id, "sessions");
        }

        let result = { message: err };
        return Result.emit(currentUser, command, 404, result);
      }
      //console.log("streamsList called2", response.users);
      for (let i in response.users) {
        // console.log("streamsList called3");
        Result.emit({ socket: response.users[i] }, command, 200, {
          message: "Ok",
          list: response.streams,
        });
        var TotalConnectedDevices = Object.keys(response.streams).length;
        console.log("Total Connected Devices : " + TotalConnectedDevices);

        Log.loggingIntoFile(
          "Total Connected Devices : " + TotalConnectedDevices + "  \r\n"
        );
      }
    });
  }

  /*
   * Admin: subscribe to stream list updates
   *
   * @param    currentUser     Object
   */
  streamsObserve(currentUser) {
    var self = this;
    var command = "/v1/streams/observe";
    if (
      typeof currentUser.mappingId !== "undefined" &&
      typeof currentUser.id !== "undefined"
    ) {
      let mappingId = currentUser.mappingId;
      let loggingData = `streamsObserve joins and ready to view stream with mappingId : ${mappingId} \r\n`;
      loggingData += `and socketId : ${currentUser.id} \r\n`;

      Log.loggingIntoFile(loggingData, mappingId, "debugLog");
      Log.loggingIntoFile(loggingData, currentUser.id, "sessions");
    }

    new Stream().observe(currentUser, (err) => {
      if (err) {
        if (
          typeof currentUser.mappingId !== "undefined" &&
          typeof currentUser.id !== "undefined"
        ) {
          let mappingId = currentUser.mappingId;
          let loggingData = `streamsObserve error :${JSON.stringify(
            err
          )} with mappingId : ${mappingId} \r\n`;
          loggingData += `and socketId : ${currentUser.id} \r\n`;

          Log.loggingIntoFile(loggingData, mappingId, "debugLog");
          Log.loggingIntoFile(loggingData, currentUser.id, "sessions");
        }

        result.message = err;
        return Result.emit(currentUser, command, 404, result);
      }
      Result.emit(currentUser, command, 200, { message: "Ok" });
      self.streamsList(currentUser);
    });
  }

  /*
   * Admin: stop receiving stream list updates
   *
   * @param    currentUser     Object
   */
  streamAbandon(currentUser) {
    var self = this;
    var command = "/v1/streams/abandon";
    var result = self.makeResult(data);
    if (
      typeof currentUser.mappingId !== "undefined" &&
      typeof currentUser.id !== "undefined"
    ) {
      let mappingId = currentUser.mappingId;
      let loggingData = `streamAbandon  with mappingId : ${mappingId} \r\n`;
      loggingData += `and socketId : ${currentUser.id} \r\n`;

      Log.loggingIntoFile(loggingData, mappingId, "debugLog");
      Log.loggingIntoFile(loggingData, currentUser.id, "sessions");
    }

    new Stream().abandon(currentUser, (err) => {
      if (err) {
        if (
          typeof currentUser.mappingId !== "undefined" &&
          typeof currentUser.id !== "undefined"
        ) {
          let mappingId = currentUser.mappingId;
          let loggingData = `streamAbandon error :  ${JSON.stringify(
            err
          )} with mappingId : ${mappingId} \r\n`;
          loggingData += `and socketId : ${currentUser.id} \r\n`;

          Log.loggingIntoFile(loggingData, mappingId, "debugLog");
          Log.loggingIntoFile(loggingData, currentUser.id, "sessions");
        }

        result.message = err;
        return Result.emit(currentUser, command, 404, result);
      }
      Result.emit(currentUser, command, 200, result);
    });
  }

  /**
   *   Alive request
   *
   */
  alive(currentUser) {}

  /**
   *   Parse and prepare incoming command
   *
   * @param    packet          array       Request params
   * @param    currentUser     Object
   */
  getCommand(packet, currentUser) {
    var self = this;
    var command = packet[0];
    if (!packet) {
      if (
        typeof currentUser.mappingId !== "undefined" &&
        typeof currentUser.id !== "undefined"
      ) {
        let mappingId = currentUser.mappingId;
        let loggingData = `error empty packet with mappingId : ${mappingId} \r\n`;
        loggingData += `and socketId : ${currentUser.id} \r\n`;

        Log.loggingIntoFile(loggingData, mappingId, "debugLog");
        Log.loggingIntoFile(loggingData, currentUser.id, "sessions");
      }
      Log.loggingIntoFile("Empty packet! \r\n", "error");

      return null;
    }
    if (!command) {
      return null;
    }
    command = command.replace(/^\/?v1/, "").trim();
    command = command.replace(/^\//, "").trim();
    command = command.replace(/\/$/, "").trim();

    if (command != "alive" && command.indexOf("log/") == -1) {
      //if (command != 'alive') {
      if (
        command.toString().trim() != "alive" &&
        command.toString().trim() != "stream/stats"
      ) {
        let loggingData = `Command: : ${command} \r\n`;
        if (typeof currentUser.mappingId !== "undefined") {
          let mappingId = currentUser.mappingId;
          loggingData = ` with mappingId : ${mappingId} \r\n`;
        }
        Log.loggingIntoFile(loggingData);
      }
    }
    return command;
  }

  /*
   * Validate input data and emit error if something is missing
   *
   * @param command    string      what command is executed
   * @param data       array       Input data
   * @param fields     array       List of fields to check
   * @return           bool        If data valid or no
   *
   */
  validate(currentUser, command, data, fields) {
    for (let i in fields) {
      var field = fields[i];
      if (!data[field]) {
        Result.emit(currentUser, command, 400, {
          message: "No " + field + " passed",
        });
        return false;
      }
    }
    return true;
  }

  /*
   * Create a result returning object
   *
   * @param data       array       Input data
   * @return           object      Prepared result object
   *
   */
  makeResult(data) {
    var result = { message: "Ok" };
    if (data.id) {
      result.id = data.id;
    }
    if (data.id) {
      result.id = data.id;
    }
    if (data.stream) {
      result.stream = data.stream;
    }
    return result;
  }
  streamStats(data) {
    let statsData = JSON.parse(data);

    //Log.message(data, "", fileName, filePath, "stats");

    if (
      typeof statsData.mappingId !== "undefined" &&
      typeof statsData.id !== "undefined"
    ) {
      let mappingId = statsData.mappingId;
      let filePath = mappingId + "/";

      let loggingData = `stats for mappingId : ${mappingId} \r\n`;
      Log.loggingIntoFile(loggingData);
      loggingData += `stats data : ${JSON.stringify(statsData)} \r\n`;
      Log.loggingIntoFile(loggingData);
      Log.loggingIntoFile(data, statsData.id, "stats", "", filePath);
    }
  }
  /**
   * screenControl with Socket
   *
   * @param    currentUser     Object
   * @param    data            Object      data passed from browser/viewer
   */

  screenControl(currentUser, data) {
    var self = this;
    var command = "/v1/user/screen/control";
    var result = self.makeResult(data);
    var valid = self.validate(currentUser, command, data, ["screenData"]);
    if (
      typeof currentUser.mappingId !== "undefined" &&
      typeof currentUser.id !== "undefined"
    ) {
      let mappingId = currentUser.mappingId;
      let loggingData = `screenControl2 data : ${JSON.stringify(
        data
      )}  with mappingId : ${mappingId} \r\n`;
      loggingData += `and socketId : ${currentUser.id} \r\n`;

      Log.loggingIntoFile(loggingData, mappingId, "debugLog");
    }
    console.log("valid", data);
    if (!valid) {
      return false;
    }
    new Stream().load(data.stream, (err, streamObject) => {
      if (err) {
        if (
          typeof currentUser.mappingId !== "undefined" &&
          typeof currentUser.id !== "undefined"
        ) {
          let mappingId = currentUser.mappingId;
          let loggingData = `screenControl2 error : ${JSON.stringify(
            err
          )}  with mappingId : ${mappingId} \r\n`;
          loggingData += `and socketId : ${currentUser.id} \r\n`;

          Log.loggingIntoFile(loggingData, mappingId, "debugLog");
        }

        Result.emit(currentUser, command, 200, result);
        return false;
      }
      Result.emit(
        { socket: streamObject.presenter.socket },
        command,
        200,
        data.screenData
      );
      if (
        typeof currentUser.mappingId !== "undefined" &&
        typeof currentUser.id !== "undefined"
      ) {
        let mappingId = currentUser.mappingId;
        let loggingData = `screenControl2 send push successfully with data : ${JSON.stringify(
          data.screenData
        )}  with mappingId : ${mappingId} \r\n`;
        loggingData += `and socketId : ${currentUser.id} \r\n`;

        Log.loggingIntoFile(loggingData, mappingId, "debugLog");
      }
    });
  }
}

module.exports = Signaling;
