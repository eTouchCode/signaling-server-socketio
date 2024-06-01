/**
 * Log module for signaling server
 *
 * @author Daniil Makeev / daniil-makeev@yandex.ru
 * @package Log
 */

var fs = require("fs");
const path = require("path");
const { sizeof } = require("file-sizeof");
var config = require("getconfig");
var FormData = require("form-data");
const fetch = require("node-fetch");

class Log {
  constructor() {
    var self = this;
    self.baseDirPath = config.logging.dir;
    self.serverLogFileName =
      self.baseDirPath + config.logging.server + config.logging.ext;
    self.errorLogFileName =
      self.baseDirPath + config.logging.error + config.logging.ext;
  }
  /**
   * Store log message
   *
   * @param    message   string
   * @param    ip        User IP of User object
   * @returns  bool
   */
  async message(message, ip, logFileName, subDirPath, logType) {
    // console.log("message", message);
  }

  /**
   * Store log notification
   *
   * @param    message   string
   * @param    ip        User IP of User object
   * @returns  bool
   */
  notification(message, ip) {
    var self = this;
    message = self.prepareMessage(message);
    self.message(message, ip);
  }

  /**
   * Store log error
   *
   * @param    message   string
   * @param    ip        User IP of User object
   * @returns  bool
   */
  error(message, ip) {}

  /**
   * Prepare log message
   *
   * @param    message   string
   * @returns  string
   */
  prepareMessage(message) {
    var self = this;
    try {
      if (message && typeof message === "object") {
        var cache = [];
        message = JSON.stringify(message, (key, value) => {
          if (typeof value === "object" && value !== null) {
            if (cache.indexOf(value) !== -1) {
              // Circular reference found, discard key
              return;
            }
            // Store value in our collection
            cache.push(value);
          }
          return value;
        });
        cache = null; // Enable garbage collection
        message = JSON.stringify(message);
      }
      message = typeof message == "string" ? message.substr(0, 2000) : "";
      return message;
    } catch (e) {
      self.error("Error in self.prepareMessage: " + e.message);
      return e.message;
    }
  }
  createFileOrDirectory(dirPath, fileName) {
    var self = this;
    try {
      /** CHECK DIR */
      if (dirPath && !fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true }, (error) => {
          if (error) {
            self.error("An error occurred " + error);
            return error;
          } else {
            // self.message("Your directory is created : " + dirPath);
          }
        });
      }

      /** CHECK FILE */
      if (fileName && !fs.existsSync(fileName)) {
        fs.writeFile(fileName, "", (err) => {
          if (err) {
            self.error("An error occurred creating file " + err);
            return err;
          }
          // self.message(fileName + " file created successfully");
        });
      }
    } catch (e) {
      self.error("Error in creating " + e.message);
      return e.message;
    }
  }

  createDirectory(dirPath) {
    var self = this;
    try {
      if (dirPath && !fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true }, (error) => {
          if (error) {
            self.error("An error occurred " + error);
          } else {
            self.message("Your directory is created " + dirPath);
          }
        });
      }
    } catch (e) {
      self.error("Error in creating " + e.message);
    }
  }
  createFile(fileName) {
    var self = this;
    if (fileName && !fs.existsSync(fileName)) {
      fs.writeFile(fileName, "", (err) => {
        if (err) {
          self.error("An error occurred creating file " + err);
        } else {
          self.message("Your file is created : " + fileName);
        }
      });
    }
  }

  prepareData(fileNameParam, filePath, action) {
    var self = this;
    try {
      if (action.type == "debugLog") {
        var fileData = fs.createReadStream(filePath);
        if (fileData) {
          var fileName = fileNameParam + "-DEBUGLOG-" + Date.now() + action.ext;
          var formData = new FormData();

          formData.append("serverFileName", fileName);

          formData.append("file", fs.createReadStream(filePath));
          return formData;
        } else {
          self.message("empty file ");
          return false;
        }
      } else if (action.type == "statsLog") {
        let fileName = fileNameParam + "-STATS-" + Date.now() + action.ext;

        // Split the string into an array of JSON strings
        const jsonStrings = action.content
          .split("\r\n")
          .filter((line) => line.trim() !== "");
        // console.log("jsonStrings", jsonStrings);
        // Parse each JSON string into an object and store them in an array
        const jsonArray = jsonStrings.map((jsonString) =>
          JSON.parse(jsonString)
        );
        // console.log("jsonArray", jsonArray);
        let formData = new FormData();
        formData.append("mappingId", action.mappingId);
        for (let i = 0; i < jsonStrings.length; i++) {
          try {
            const jsonObject = JSON.parse(jsonStrings[i]);
            formData.append(`formData[${i}]`, JSON.stringify(jsonObject));
          } catch (error) {
            console.error(`Error parsing JSON at index ${i}:`, error.message);
          }
        }
        //  console.log("formData", formData);
        return formData;
      }
    } catch (err) {
      self.error(
        "Error in prepare payload " + JSON.stringify(err.message) + "\r\n",
        "error"
      );
    }
  }
  async webServiceCall(action, fileName, filePath) {
    var self = this;
    var payload = {};
    try {
      if (action.type == "debugLog" || action.type == "statsLog") {
        console.log("webServiceCall ", action.type);
        /*READ FILE DATA*/
        payload = self.prepareData(fileName, filePath, action);
        console.log("webServiceCall ", payload);
      }

      if (action.url && payload) {
        self.loggingIntoFile(
          `post url : ${action.url} and file name : ${fileName} and action : ${action.type} \r\n`
        );

        const options = {
          method: action.method,
          headers: payload.getHeaders(),
          body: payload,
        };
        // console.log("webServiceCall ", options);
        //  let testUrl = "https://ns-cp.vantagemdm.com/test3.php";
        await fetch(action.url, options)
          .then((handleResponse) => handleResponse.json())
          .then((response) => {
            console.log("webServiceCall", response);
            if (action.type == "debugLog") {
              self.loggingIntoFile(
                `file : ${fileName} and response received : ${JSON.stringify(
                  response
                )} and action : ${action.type} \r\n`,
                fileName,
                "debugLog"
              );
            } else {
              self.loggingIntoFile(
                `file : ${fileName} response received : ${JSON.stringify(
                  response
                )}  \r\n`
              );
            }
            if (response.code == 100) {
              if (action.type == "debugLog" || action.type == "statsLog") {
                /*REMOVE FILE */
                fs.unlink(filePath, function (err) {
                  if (err) throw err;
                  // if no error, file has been deleted successfully

                  self.loggingIntoFile(
                    `File : ${fileName} deleted successfully!  \r\n`
                  );
                });
              } else {
                self.loggingIntoFile(`100 response received  \r\n`);
              }
            } else {
              self.loggingIntoFile(`File : ${JSON.stringify(response)}  \r\n`);
            }
          })
          .catch((error) => {
            let loggingData = `Server Response ERROR : ${JSON.stringify(
              error
            )} \r\n`;

            if (error.response) {
              loggingData += `Status Code : ${error.response.status} \r\n`;

              error.response.text().then((responseText) => {
                //console.error("Response Text:", responseText); // Response text
                loggingData += `Response Text : ${responseText} \r\n`;
              });
            }
            self.loggingIntoFile(loggingData, "error");
          });
      } else {
        //console.log("webservice not called because empty payload");
        self.loggingIntoFile(
          `webservice not called because empty payload \r\n`,
          "error"
        );
      }
    } catch (err) {
      self.loggingIntoFile(
        `Error in uploading : ${JSON.stringify(err.message)} \r\n`,
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

  readAllFilesFromDirectory(dirname, mappingId) {
    var self = this;
    console.log("readAllFilesFromDirectory", dirname, mappingId);
    fs.readdir(dirname, function (err, filenames) {
      if (err) {
        console.log("directory file", err);
        return;
      }
      console.log("files :" + JSON.stringify(filenames));
      filenames.forEach(function (filename) {
        fs.readFile(dirname + filename, "utf-8", function (err, content) {
          if (err) {
            self.loggingIntoFile(
              `cannot read the file, something goes wrong with the file : ${JSON.stringify(
                err
              )} \r\n`,
              "error"
            );
            return;
          }
          var url =
            config.logging.serverUrl + config.logging.webServices.statsLog;
          self.webServiceCall(
            {
              type: "statsLog",
              method: "POST",
              url: url,
              mappingId: mappingId,
              content: content,
              ext: config.logging.stats.ext,
            },
            filename,
            dirname + filename
          );
          //console.log("file read :"+content);
        });
      });
    });
  }

  /**
   * Store log message
   *
   * @param    loggingPath   string
   * @param    data          log data string
   * @param    fileName      log fileName string
   * @param    action        stat/debuglog etc string
   * @param    logType       (new/appent) string
   
   */
  async loggingIntoFile(
    data,
    fileName = "",
    action = "",
    logType = "",
    subDir = ""
  ) {
    let self = this;
    let loggingPath = config.logging.dir;
    let serverLogFileName = config.logging.server;

    self.baseDirPath + config.logging.server + config.logging.ext;

    const currentDate = new Date();
    const year = currentDate.getFullYear();
    const month = (currentDate.getMonth() + 1).toString().padStart(2, "0");
    if (!fileName) {
      fileName = `${serverLogFileName}_${year}-${month}${config.logging.ext}`;
    } else {
      if (action === "sessions" || action === "debugLog") {
        fileName = `${fileName}${config.logging.ext}`;

        loggingPath = `${config.logging.dir}${config.logging.debugLog.dir}`;
      } else if (action === "stats") {
        fileName = `${fileName}${config.logging.ext}`;
        loggingPath = `${config.logging.dir}${config.logging.stats.dir}`;
        if (subDir) {
          loggingPath = `${config.logging.dir}${config.logging.stats.dir}${subDir}`;
        }
      } else {
        fileName = `${fileName}_${year}-${month}${config.logging.ext}`;
      }
    }

    try {
      let log = "";

      if (!logType) {
        logType = "NEW";
      }

      if (logType === "NEW") {
        log = "\r\n===================================================\r\n";
      }
      const file = path.join(loggingPath, fileName);
      if (!fs.existsSync(loggingPath)) {
        fs.mkdirSync(loggingPath, { recursive: true });
      }

      let REMOTE_ADDR = "";
      if (process.env.REMOTE_ADDR) {
        REMOTE_ADDR = process.env.REMOTE_ADDR;
      }

      log += `${new Date().toLocaleString()} \r\n`;
      log += `${data} \r\n`;
      if (action === "stats") {
        log = data + "\r\n";

        // message = JSON.stringify(data);
      }
      // console.log("fileName", file);

      if (!fs.existsSync(file)) {
        // The file doesn't exist, create it and write content
        fs.writeFileSync(file, log);
        //console.log(`File "${filePath}" created.`);
      } else {
        //console.log(`File "${filePath}" already exists.`);
        fs.appendFileSync(file, log);
      }
    } catch (e) {
      console.log("Error " + e.message);
    }
  }
}

module.exports = new Log();
