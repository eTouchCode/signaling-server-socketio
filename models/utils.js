/**
 * Log module for signaling server
 *
 * @author Daniil Makeev / daniil-makeev@yandex.ru
 * @package Log
 */
var Server = require("../server.js");

var config = require("getconfig");
// Log
var Log = require("./log.js");
const fetch = require("node-fetch");

class Utils {
  constructor() {
    var self = this;
    self.phpServerUrl = config.php.serverUrl;
    self.emailServicePath = config.php.emailServicePath;
    self.retryToSaveOnRedis = 0;
    /*setInterval(() => {
      Log.message("phpServerUrl " + self.phpServerUrl);
      self.save2();
      if (self.retryToSaveOnRedis === 3) {
        //await self.webServiceCall();
      }
    }, 5000);*/
  }
  async save2() {
    let toStore = { action: "successfully saved on Redis" };
    toStore = JSON.stringify(toStore);
    // console.log(toStore);
    Server.server.redisClient
      .set(toStore)
      .then(() => {
        console.log("Value saved in Redis successfully.", toStore);
      })
      .catch((error) => {
        console.error("Error saving value in Redis:", error);
      });
  }
  async saveOnRedis() {
    //let self = this;

    let toStore = { action: "successfully saved on Redis" };

    toStore = JSON.stringify(toStore);

    try {
      // Set test data on Redis
      // await Server.server.redisClient.set(toStore);
      await Server.server.redisClient.set(toStore, (err) => {
        if (typeof err !== "undefined") {
          Log.loggingIntoFile(
            `Error setting test data on Redis Error :  ${err}  \r\n`,
            "error"
          );
        }
      });
      Log.loggingIntoFile("saveOnRedis()  " + toStore + "  \r\n");
    } catch (error) {
      if (typeof error !== "undefined") {
        Log.loggingIntoFile(
          `Error2 setting test data on Redis Error :  ${error}  \r\n`,
          "error"
        );
      }
    }
  }

  async webServiceCall(message) {
    Log.loggingIntoFile("webServiceCall " + message + " port  \r\n");
    var self = this;
    let payload = {
      action: "sendEmail",
      message: message,
    };
    let url = self.phpServerUrl + self.emailServicePath;
    try {
      Log.message("post url: " + url);
      const options = {
        method: "POST",
        body: JSON.stringify(payload),
      };

      await fetch(url, options)
        .then((handleResponse) => handleResponse.json())
        .then((response) => {
          Log.loggingIntoFile(
            "webServiceCall RESPONSE : " + JSON.stringify(response) + "  \r\n"
          );

          if (response.code === 200) {
            Log.loggingIntoFile(
              "webServiceCall Action performed successfully. :  \r\n"
            );
          } else {
            Log.loggingIntoFile(
              "webServiceCall ERROR FROM SERVER : " +
                JSON.stringify(response) +
                "  \r\n",
              "error"
            );
          }
        })
        .catch((error) => {
          Log.loggingIntoFile(
            "webServiceCall catch block error : " +
              JSON.stringify(error) +
              "  \r\n",
            "error"
          );
        });
    } catch (err) {
      Log.loggingIntoFile(
        "webServiceCall catch block error : " +
          JSON.stringify(err.message) +
          "  \r\n",
        "error"
      );
    }
  }

  handleResponse(response) {
    return response.text().then((text) => {
      console.log(text);
      const data = text && JSON.parse(text);
      if (!response.ok) {
        if (response.status === 401) {
        }

        const error = (data && data.message) || response.statusText;
        return Promise.reject(error);
      }

      return data;
    });
  }
}

module.exports = new Utils();
