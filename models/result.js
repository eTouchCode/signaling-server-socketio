/**
 * Result management for signaling server
 * Sends messages to socket.io clients
 *
 * @author Daniil Makeev / daniil-makeev@yandex.ru
 * @package Result
 */

var fs = require("fs");
var Log = require("./log.js");
var Server = require("../server.js");
var User = require("./user.js");

class Result {
  /**
   * Send message to all clients in stream
   *
   * @param streamObject object      Stream object
   * @param except       int         Send to all users except this id
   * @param command      string      Command to sent
   * @param code         int         Responce code (similar to HTTP response codes)
   * @param data         array       Result data
   * @return bool
   */
  toStream(streamObject, except, command, code, data) {
    var self = this;
    for (let i in streamObject.users) {
      var userData = streamObject.users[i];
      if (userData && (!userData.id || userData.id != except)) {
        //self.toUser(userData.id, command, code, data);
        self.emit(userData, command, code, data);
      }
    }
  }

  /**
   * Send message to all devices of user
   *
   * @param id           int         User ID
   * @param command      string      Command to sent
   * @param code         int         Responce code (similar to HTTP response codes)
   * @param data         array       Result data
   * @return bool
   */
  toUser(id, command, code, data) {
    var self = this;
    new User().load(id, (error, user) => {
      if (error) {
        return false;
      }
      for (let i in user.devices) {
        var device = user.devices[i];
        if (device.active && device.socket) {
          self.emit(device, command, code, data);
        }
      }
    });
  }

  /**
   * Send message to single device
   *
   * @param device       object|string     User device object or socket object
   * @param command      string      Command to sent
   * @param code         int         Responce code (similar to HTTP response codes)
   * @param data         array       Result data
   * @return bool
   */
  emit(device, command, code, data) {
    //sessionId
    try {
      // Socket object or Device passed
      if (device.socket) {
        var socket = device.socket;
        var ip = device.ip;
      } else {
        var socket = device.id;
        var ip = device.handshake ? device.handshake.address : "";
      }
      //console.log('Send to: ' + socket + ' ' + command);
      // Send message to socket
      if (socket) {
        data.code = code;
        Server.server.io.to(socket).emit(command, data);
      }
      // Log command
      if (code > 200 && command !== "alive") {
        var messageToSend = Log.prepareMessage(data);

        Log.loggingIntoFile(
          "Command : " +
            command +
            ", code : " +
            code +
            ", messageToSend: " +
            messageToSend +
            ", IP : " +
            ip +
            " \r\n"
        );
      }
    } catch (e) {
      Log.loggingIntoFile(
        "Error in result.emit : " + e.message + "  \r\n",
        "error"
      );
      console.log(e);
    }
  }
}

module.exports = new Result();
