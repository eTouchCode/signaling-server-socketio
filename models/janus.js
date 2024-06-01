/**
 * Janus media server interface for signaling server
 *
 * @author Daniil Makeev / daniil-makeev@yandex.ru
 * @package Janus
 */

config = require('getconfig');
var request = require('request');
var WebSocketClient = require('websocket').client;

// Base signaling server class
var Server = require('../server.js');
// Log
var Log = require('./log.js');
// User
var User = require('./user.js');
// Stream
var Stream = require('./stream.js');

class Janus {

    constructor() {
        var self = this;
        self.sender = false;
        self.rooms = {};
        self.users = {};
        self.lastRoomId = 0;
        self.lastUserId = 0;
        self.eventIntervals = {};
        self.offers = {};
        self.callbacks = {'join': {}, 'candidate': {}, 'change-publishers': {}, 'connected': {}};
        self.instanceCheckerInterval = false;
        self.cacheInstanceForRoom = {};
        self.servicePublisherId = -1;
        self.idsForPublishers = {};
    }

    /**
    * Init Janus session — executed only at master thread
    *
    * @return bool
    */
    init() {
        var self = this;
        // If server class isn't initialized now — try agait at 0.5sec
        if (!Server.server) {
            setTimeout(() => {
                self.init();
            }, 500);
            return true;
        }
        // Get available Janus instances
        self.getAvailableJanusInstances();
    }

    /**
    * Establish connection to Janus for user
    *
    * @param room         string      Room slug
    * @param userObject   object      User object
    * @param publisherId  object      User object
    * @param callback     function    Callback function
    * @return bool
    */
    createConnection(room, userObject, publisherId, callback) {
        var self = this;
        // Add connection information to user's device
        if (!userObject.device.janus) {
            userObject.device.janus = {};
        }
        if (!userObject.device.janus[room]) {
            userObject.device.janus[room] = {};
        }
        if (!userObject.device.janus[room][publisherId]) {
            userObject.device.janus[room][publisherId] = {'session': null, 'bridge': null};
        }
        // Select/get Janus instance for this room
        delete self.cacheInstanceForRoom[room];
        self.getInstanceForRoom(room, (err, instance) => {
            if (err) {
                return false;
            }
            Log.message('Media instance ' + instance.host + ' is used for room ' + room);
            // Create Janus connection
            var params = {'janus': 'create', 'transaction': 'Transaction'};
            self.request('POST', instance, '/janus', params, result => {
                if (result && result.janus == 'success') {
                    userObject.load((err, fake) => {
                        userObject.device.janus[room][publisherId].session = result.data.id;
                        // Attach Videoroom
                        var params = {
                            "janus" : "attach",
                            "plugin" : "janus.plugin.videoroom",
                            "transaction" : 'Transaction'
                        };
                        self.request('POST', instance, '/janus/' + result.data.id, params,  result => {
                            if (result && result.janus == 'success') {
                                userObject.device.janus[room][publisherId].bridge = result.data.id;
                                userObject.save(err => {
                                    return callback();
                                });
                            } else {
                                Log.error('Janus: error in videoroom connection for user ' + userObject.id);
                            }
                        });
                    });
                } else {
                    Log.error('Janus: error in connection for user ' + userObject.id + ', Janus instance ' + instance.host + ' disabled');
                    self.janusInstancesLoad(true, (err, instances, lock) => {
                        instances[instance.host].connected = false;
                        delete self.cacheInstanceForRoom[room];
                        var data = JSON.parse(room);
                        new Stream().load(data, (err, streamObject) => {
                            if (!err) {
                                lock.unlock();
                                streamObject.mediaInstance = null;
                                streamObject.save();
                            }
                            self.janusInstancesSave(instances, () => {
                                lock.unlock();
                                self.createConnection(room, userObject, publisherId, callback);
                            });
                        });
                    });
                }
            });
        });
    }

    /**
    * Create room, if not exists
    *
    * @param room         string      Room slug
    * @param userObject   object      User object
    * @param publisherId  object      User object
    * @param callback     function    Callback function
    * @return bool
    */
    createRoom(room, userObject, publisherId, callback) {
        var self = this;
        // Get numeric room ID
        self.getRoomId(room, (err, roomId) => {
            var params = {
                "janus" : "message",
                "transaction" : 'Transaction',
                "body": {
                    "request" : "exists",
                    "room" : roomId,
                }
            }
            // Get actual Janus instance for this room
            self.getInstanceForRoom(room, (err, instance) => {
                // Generate request url
                var url = self.getUrl(userObject, room, publisherId);
                self.request('POST', instance, url, params, result => {
                    // Room exists? Return it
                    if (result && result.plugindata && typeof result.plugindata.data.exists != 'undefined' && result.plugindata.data.exists) {
                        return callback();
                    // Create a new room
                    } else if (result && result.janus == 'success') {
                        var params = {
                            "janus" : "message",
                            "transaction" : 'Transaction',
                            "body": {
                                "request" : "create",
                                "room" : roomId,
                                "permanent" : false,
                                "is_private" : false,
                                "videocodec": "vp9",
                                "transport_wide_cc_ext": true,
                                "fir_freq":1,
                                "video_svc": true
                            }
                        };
                        console.log(params);
                        self.request('POST', instance, url, params, result => {
                            console.log(result);
                            if (result && result.janus == 'success') {
                                return callback();
                            } else {
                                Log.error('Videoroom error', result);
                            }
                        });
                    } else {
                        return callback();
                        Log.message('Room exists: ' + roomId);
                    }
                });
            });
        });
    }

    /**
    * User joins stream
    *
    * @param room         string      Room slug
    * @param streamObject object      Stream object
    * @param userObject   object      User object
    * @param publisherId  integer     ID of publisher to watch - for subscriber. If no publisherId set - user is publisher
    * @param data         array       Stream creation params - offer, if video and audio required
    * @param callback     function    Callback function
    * @return bool
    */
    joinStream(streamObject, userObject, publisherId, data, callback) {
        var self = this;
        // Get room slug from streamObject — we use string slug, not numeric ID for rooms
        var room = self.getRoomByStream(streamObject);
        publisherId = publisherId ? publisherId : 0;
        // If offer set — store it for current device, we will use it in Janus events in future
        if (data && data.offer) {
            if (!self.offers[userObject.device.device]) {
                self.offers[userObject.device.device] = {};
            }
            self.offers[userObject.device.device][publisherId] = data.offer;
        }
        // Store callback, we will use it in Janus events in future
        if (!self.callbacks['join'][userObject.device.device]) {
            self.callbacks['join'][userObject.device.device] = {};
        }
        self.callbacks['join'][userObject.device.device][publisherId] = callback;
        // Check if connection exists
        console.log('A1');
        self.createConnection(room, userObject, publisherId, () => {
            console.log('A2');
            // Start event processing
            self.processEvent(room, userObject, publisherId);
            console.log('A3');
            // Check if room is created
            self.createRoom(room, userObject, publisherId, err => {
                console.log('A4');
                // Get numeric ID for room
                self.getRoomId(room, (err, roomId) => {
                    console.log('A5');
                    // Add publisher
                    if (!publisherId) {
                        var params = {
                            "janus" : "message",
                            "transaction" : 'Transaction',
                            "body": {
                                "request": "joinandconfigure",
                                "room" : roomId,
                                "ptype" : "publisher",
                                "keyframe" : true,
                                "video": data && !data.video ? false : true,
                                "audio": data && !data.audio ? false : true,
                                "data": false,
                            }
                        };
                    // Add subscriber
                    } else {
                        // Client sends publisher ID as "<subscriberId>-<callId>-<publisherId>"
                        // As several subscribers can watch several publishers in one room
                        var publisherReadId = publisherId.match(/\d+$/)[0];
                        var params = {
                            "janus" : "message",
                            "transaction" : 'Transaction',
                            "body": {
                                "request": "join",
                                "room" : roomId,
                                "ptype" : "subscriber",
                                "video": true,
                                "audio": false,
                                "data": false,
                                "offer_video": true,
                                "offer_audio": false,
                                "offer_data": false,
                                "feed": Number(publisherReadId)
                            }
                        };
                    }
                    console.log('A6', params);
                    self.getInstanceForRoom(room, (err, instance) => {
                        console.log('A7', instance);
                        self.request('POST', instance, self.getUrl(userObject, room, publisherId), params);
                    });
                });
            });
        });
    }

    /**
    * Stop streaming
    *
    * @param streamObject object      Stream object
    * @param userObject   object      User object
    * @return bool
    */
    finishStream(streamObject, userObject, callback) {
        var self = this;
        var params = {
            "janus" : "message",
            "transaction" : 'Transaction',
            "body": {
                "request" : "leave"
            }
        };
        // There are 2 possible variants of streamObject incoming param:
        // - real streamObject when it's called from outside
        // - room slug, when it's called from Janus event
        if (streamObject.id) {
            var room = self.getRoomByStream(streamObject);
        } else {
            var room = streamObject;
        }
        callback = callback ? callback : () => {};
        var instance = self.getInstanceForRoom(room, (err, instance) => {
            self.request('POST', instance, self.getUrl(userObject, room, 0), params);
            callback();
        });
    }

    /**
    * Forward ADP Answer from user to Janus
    *
    * @param streamObject object      Stream object
    * @param userObject   object      User object
    * @param publisherId  integer     ID of publisher to watch - for subscriber
    * @param sdpAnswer    string      SDP Answer
    * @return bool
    */
    addAnswer(streamObject, userObject, publisherId, sdpAnswer) {
        var self = this;
        var room = self.getRoomByStream(streamObject);
        publisherId = publisherId ? publisherId : 0;
        var params = {
            "janus" : "message",
            "transaction" : 'Transaction',
            "body": {
                "request" : "start",
            },
            "jsep": {
                "type" : "answer",
                "sdp" : sdpAnswer
            }
        };
        var instance = self.getInstanceForRoom(room, (err, instance) => {
            self.request('POST', instance, self.getUrl(userObject, room, publisherId), params);
        });
    }

    /**
    * Forward ICE candidate from user to Janus
    *
    * @param streamObject object      Stream object
    * @param userObject   object      User object
    * @param publisherId  integer     ID of publisher to watch
    * @param candidate    string      ICE candidate
    * @return bool
    */
    addCandidate(streamObject, userObject, publisherId, candidate) {
        var self = this;
        var room = self.getRoomByStream(streamObject);
        publisherId = publisherId ? publisherId : 0;
        var params = {
            "janus" : "trickle",
            "transaction" : "Transaction",
            "candidate" : candidate ? candidate : null
        };

        var instance = self.getInstanceForRoom(room, (err, instance) => {
            self.request('POST', instance, self.getUrl(userObject, room, publisherId), params);
        });
    }

    /**
    * Toggle media for stream
    *
    * @param streamObject object      Stream object
    * @param userObject   object      User object
    * @param blind        bool        true = disable video, false = enable video
    * @param callback     function    Callback function
    * @return bool
    */
    mediaToggle(streamObject, userObject, data, callback) {
        var self = this;
        var room = self.getRoomByStream(streamObject);
        var publisherId = 0;
        var params = {
            "janus" : "message",
            "transaction" : 'Transaction',
            "body": {
                "request" : "configure",
                "audio": data.audio ? true : false,
                "video": data.video ? true : false
            }
        };
        var instance = self.getInstanceForRoom(room, (err, instance) => {
            self.request('POST', instance, self.getUrl(userObject, room, publisherId), params);
        });
    }

    /**
    * Callback on new ICE candidate from Janus
    *
    * @param userObject   object      User object
    * @param publisherId  integer     ID of publisher to watch
    * @param callback   function    Callback
    * @return bool
    */
    onCandidate(userObject, publisherId, callback) {
        var self = this;
        publisherId = publisherId ? publisherId : 0;
        if (!self.callbacks['candidate'][userObject.device.device]) {
            self.callbacks['candidate'][userObject.device.device] = {};
        }
        self.callbacks['candidate'][userObject.device.device][publisherId] = callback;
    }

    /**
    * Callback on change publisher list
    *
    * @param streamObject object      Stream object
    * @param userObject   object      User object
    * @param callback   function    Callback
    * @return bool
    */
    onChangePublishers(streamObject, userObject, callback) {
        var self = this;
        self.callbacks['change-publishers'][userObject.device.device] = (err, publishers) => {
            callback(err, publishers);
        }
    }

    /**
    * Callback fired when user is connected to Janus
    *
    * @param streamObject object      Stream object
    * @param userObject   object      User object
    * @param callback   function    Callback
    * @return bool
    */
    onConnected(streamObject, userObject, callback) {
        var self = this;
        self.callbacks['connected'][userObject.device.device] = err => {
            callback(err);
        }
    }

    /**
    * Process Janus events
    *
    * @param room         string      Room slug
    * @param userObject   object      User object
    * @param publisherId  integer     ID of publisher to watch - for subscriber
    * @param lastCall     bool        If true - stop event processing for this subscriber-publisher pair
    * @return bool
    */
    processEvent(room, userObject, publisherId, lastCall) {
        var self = this;
        // Get isntance for current room
        var instance = self.getInstanceForRoom(room, (err, instance) => {
            // There is no janus credentials for current device? Strange!
            if (!userObject.device.janus || !userObject.device.janus[room] || !userObject.device.janus[room][publisherId] || !userObject.device.janus[room][publisherId].session) {
                Log.error('No Janus credentials for user ' + userObject.id);
                return false;
            }
            // Request for event
            self.request('GET', instance, '/janus/' + userObject.device.janus[room][publisherId].session, {}, result => {
                try {
                    // Empty value? Make a new request
                    if (!result) {
                        self.processEvent(room, userObject, publisherId);
                        return false;
                    }
                    // Parse event JSON
                    try {
                        result = JSON.parse(result);
                    } catch(e) {
                        Log.error('Janus event error', e);
                    }
                    console.log('Janus event -------------------------------------------');
                    console.log(result);

                    if (!result) {
                        return Log.error('Janus event without result');
                    }

                    // Kepp alive
                    if (result.janus == 'keepalive') {
                        // Nothing to do
                    // Media events
                    } else if (result.janus == 'media' || result.janus == 'webrtcup') {
                        // If media is disconnected - finish stream
                        if (result.janus == 'media' && result.receiving == false) {
                            self.finishStream(room, userObject);
                        } else if (result.janus == 'media' && result.receiving == true) {
                            if (self.callbacks['connected'][userObject.device.device]) {
                                self.callbacks['connected'][userObject.device.device](null, result.candidate);
                                delete self.callbacks['connected'][userObject.device.device];
                            }
                        }
                        // Notify users about user list change
                        if (self.callbacks['change-publishers'][userObject.device.device]) {
                            self.getPublishers(userObject, room, publisherId, instance, (err, publishers) => {
                                self.callbacks['change-publishers'][userObject.device.device](err, publishers);
                            });
                        }
                    // Answer generated by Janus
                    } else if (result.jsep && result.jsep.type == 'answer' && result.jsep.sdp) {
                        // Execute callback at stream creation and pass answer / publisher ID to it
                        // For publisher
                        if (self.callbacks['join'][userObject.device.device][publisherId]) {
                            if (self.idsForPublishers[room] && self.idsForPublishers[room][userObject.device.device]) {
                                var result = {sdp: result.jsep.sdp, publisherId: self.idsForPublishers[room][userObject.device.device]};
                            } else {
                                var result = {sdp: result.jsep.sdp, publisherId: 0};
                            }
                            self.callbacks['join'][userObject.device.device][publisherId](null, result);
                            delete self.callbacks['join'][userObject.device.device][publisherId];
                        }
                    // Process ICE candidate
                    } else if (result.janus == 'trickle' && result.candidate && result.candidate.candidate) {
                        if (self.callbacks['candidate'][userObject.device.device][publisherId]) {
                            self.callbacks['candidate'][userObject.device.device][publisherId](null, result.candidate);
                        }
                    // Process ICE candidates finish
                    } else if (result.janus == 'trickle' && result.candidate && result.candidate.completed) {
                        if (self.callbacks['candidate'][userObject.device.device][publisherId]) {
                            delete self.callbacks['candidate'][userObject.device.device][publisherId];
                        }
                    // Publisher joined
                    } else if (result.plugindata && result.plugindata.data && result.plugindata.data.videoroom == 'joined') {
                        // Send stored user offer to Janus
                        var params = {
                            "janus" : "message",
                            "transaction" : 'Transaction',
                            "body": {
                                "request" : "configure",
                            },
                            "jsep": self.offers[userObject.device.device][publisherId]
                            /*
                            "jsep": {
                                "type" : "offer",
                                "sdp" : self.offers[userObject.device.device][publisherId]
                            }
                            */
                        };
                        if (!self.idsForPublishers[room]) {
                            self.idsForPublishers[room] = {};
                        }
                        // Store publiserId for userId
                        self.idsForPublishers[room][userObject.device.device] = result.plugindata.data.id;
                        // Notify users about user list change
                        self.request('POST', instance, self.getUrl(userObject, room, publisherId), params, (err, data) => {
                            if (self.callbacks['change-publishers'][userObject.device.device]) {
                                self.getPublishers(userObject, room, publisherId, instance, (err, publishers) => {
                                    self.callbacks['change-publishers'][userObject.device.device](err, publishers);
                                });
                            }
                        });
                    // Viewer joined
                    } else if (result.plugindata && result.plugindata.data && result.plugindata.data.videoroom == 'attached') {
                        // Execute callback at stream creation and pass answer / publisher ID to it
                        // For subscriber
                        if (self.callbacks['join'][userObject.device.device][publisherId]) {
                            self.callbacks['join'][userObject.device.device][publisherId](null, result.jsep.sdp);
                            delete self.callbacks['join'][userObject.device.device][publisherId];
                        }
                        // Notify users about user list change
                        if (self.callbacks['change-publishers'][userObject.device.device]) {
                           self.getPublishers(userObject, room, publisherId, instance, (err, publishers) => {
                               self.callbacks['change-publishers'][userObject.device.device](err, publishers);
                           });
                       }
                    // Turned on/off video/audio
                    } else if (result.plugindata && result.plugindata.data && result.plugindata.data.configured) {
                        // Notify users about user list change
                        if (self.callbacks['change-publishers'][userObject.device.device]) {
                            self.getPublishers(userObject, room, publisherId, instance, (err, publishers) => {
                                self.callbacks['change-publishers'][userObject.device.device](err, publishers);
                            });
                        }
                    // Hangup event
                    } else if (result.janus == 'hangup') {
                        // Notify users about user list change
                        if (self.callbacks['change-publishers'][userObject.device.device]) {
                            self.getPublishers(userObject, room, publisherId, instance, (err, publishers) => {
                                self.callbacks['change-publishers'][userObject.device.device](err, publishers);
                            });
                        }
                    // Publisher had left the room
                    } else if (result.plugindata && result.plugindata.data && result.plugindata.data.videoroom == 'left') {
                        // If we know room ID for user
                        // Check number of users in room and, if it`s empty, destroy the room
                        self.getRoomId(room, (err, roomId) => {
                            if (roomId) {
                                var params = {
                                    "janus" : "message",
                                    "transaction" : 'Transaction',
                                    "body": {
                                        "request" : "listparticipants",
                                        "room": roomId
                                    }
                                };
                                self.request('POST', instance, self.getUrl(userObject, room, publisherId), params, res => {
                                    if (!res || !res.plugindata || !res.plugindata.data || !res.plugindata.data.participants || !res.plugindata.data.participants.length) {
                                        delete self.cacheInstanceForRoom[room];
                                        var data = JSON.parse(room);
                                        new Stream().load(data, (err, streamObject) => {
                                            if (!err) {
                                                streamObject.mediaInstance = null;
                                                streamObject.save();
                                            }
                                        });
                                        var params = {
                                            "janus" : "message",
                                            "transaction" : 'Transaction',
                                            "body": {
                                                "request" : "destroy",
                                                "room": roomId
                                            }
                                        };
                                        self.request('POST', instance, self.getUrl(userObject, room, publisherId), params, result => {
                                            userObject.load((err, fake) => {
                                                delete userObject.device.janus[room][publisherId];
                                                userObject.save();
                                            });
                                        });
                                    } else {
                                        userObject.load((err, fake) => {
                                            delete userObject.device.janus[room][publisherId];
                                            userObject.save();
                                        });
                                    }
                                });
                            } else {
                                userObject.load((err, fake) => {
                                    delete userObject.device.janus[room][publisherId];
                                    userObject.save();
                                });
                            }
                        });
                        if (self.callbacks['candidate'][userObject.device.device][publisherId]) {
                            self.callbacks['candidate'][userObject.device.device][publisherId](null, result.candidate);
                        }
                        // Stop event processing
                        self.processEvent(room, userObject, publisherId, true);
                        return true;
                    } else if(result.plugindata && result.plugindata.data && result.plugindata.data.videoroom == 'left') {
                        // User disconnected from Janus
                        userObject.load((err, fake) => {
                            delete userObject.device.janus[room][publisherId];
                            userObject.save();
                        });
                        // Notify users about user list change
                        if (self.callbacks['change-publishers'][userObject.device.device]) {
                            self.getPublishers(userObject, room, publisherId, instance, (err, publishers) => {
                                self.callbacks['change-publishers'][userObject.device.device](err, publishers);
                            });
                        }
                        self.processEvent(room, userObject, publisherId, true);
                        return true;
                    } else {
                        //console.log('Unhandled event +++++++++++++++++++++++++++++++++++++++++++++++++++++++++');
                        //console.log(result);
                    }
                    if (!lastCall) {
                        self.processEvent(room, userObject, publisherId);
                    }
                } catch(e) {
                    Log.error('Janus event error: ' + e.message);
                    console.log(e);
                    self.processEvent(room, userObject, publisherId);
                }
            });
        });
    }

    /**
    * Get publisher list — request from signaling server
    *
    * @param streamObject object      Stream object
    * @param userObject   object      User object
    * @param callback     function    Callback function
    * @return bool
    */
    getPublishersExt(streamObject, userObject, callback) {
        var self = this;
        var room = streamObject.id;
        room = JSON.stringify(room);
        self.getInstanceForRoom(room, (err, instance) => {
            self.createConnection(room, userObject, self.servicePublisherId, () => {
                self.getPublishers(userObject, room, self.servicePublisherId, instance, callback);
            });
        });
    }

    /**
    * Get publisher list — request from inside Janus module
    * As it's requested in Janus events, it's max. lightweight,
    * we pass all possible data into it from event handler
    *
    * @param userObject   object      User object
    * @param room         string      Room slug
    * @param publisherId  integer     ID of publisher to watch - for subscriber. If no publisherId set - user is publisher
    * @param instance     object      Janus instance for use
    * @param callback     function    Callback function
    * @return bool
    */
    getPublishers(userObject, room, publisherId, instance, callback) {
        var self = this;
        self.getRoomId(room, (err, roomId) => {
            var params = {
                "janus" : "message",
                "transaction" : 'Transaction',
                "body": {
                    "request": "listparticipants",
                    "room" : roomId
                }
            };
            self.request('POST', instance, self.getUrl(userObject, room, publisherId), params, data => {
                if (data.janus == 'error') {
                    return false;
                }
                var list = data.plugindata ? data.plugindata.data.participants : [];
                callback(null, list);
            });
        });
    }

    /**
    * Combine request url for selected user / room / publisher
    *
    * @param userObject   object      User object
    * @param room         string      Room slug
    * @param publisherId  integer     ID of publisher to watch - for subscriber. If no publisherId set - user is publisher
    */
    getUrl(userObject, room, publisherId) {
        var self = this;
        if (!userObject || !userObject.device || !userObject.device.janus || !userObject.device.janus[room] || !userObject.device.janus[room][publisherId]) {
            return '/janus/';
        }
        return '/janus/' + userObject.device.janus[room][publisherId].session + '/' + userObject.device.janus[room][publisherId].bridge;
    }

    /**
    * Generate numeric room ID for selected Stream as Janus assept only numeric rooms
    *
    * @param room      string      Room slug
    * @param callback  functioin   Callback function
    * @return bool
    */
    getRoomId(room, callback) {
        var self = this;
        Server.server.redisClient.hget(config.redis.janusRoomForRoom, room, (err, id) => {
            if (id - 0) {
                return callback(null, (id - 0));
            }
            var id = 10000000 + Math.round(Math.random() * 89999999);
            Server.server.redisClient.hset(config.redis.janusRoomForRoom, room, id);
            return callback(null, id);
        });
    }

    /**
    * Get media instance for room
    *
    * @param room       string      Room slug
    * @param callback functioin   Callback function
    * @return bool
    */
    getInstanceForRoom(room, callback) {
        var self = this;
        // Is it in cache? Perfectly
        if (self.cacheInstanceForRoom[room]) {
            var instance = self.cacheInstanceForRoom[room];
            return callback(null, instance);
        }
        // Get instances load with it's load
        self.janusInstancesLoad(false, (err, instances) => {
            var data = JSON.parse(room);
            // Load actual stream
            new Stream().load(data, (err, streamObject) => {
                // Can't load stream? Return random instance as it doesn't matter and full streaming process will be broken
                if (err) {
                    var keys = Object.keys(instances);
                    var instance = instances[keys[keys.length * Math.random() << 0]];
                    self.cacheInstanceForRoom[room] = instance;
                    return callback(err, instance);
                }
                // Is it set in Instance details? Perfectly, return it
                if (streamObject && streamObject.mediaInstance && Object.keys(streamObject.users).length) {
                    instance = instances[streamObject.mediaInstance];
                    if (instance) {
                        self.cacheInstanceForRoom[room] = instance;
                        return callback(null, instance);
                    }
                }
                // Find the instance with the lowest Load Average
                var bestLoad = 10000;
                var bestInstance = false;
                for (let i in instances) {
                    if (instances[i].connected && instances[i].cpu <= bestLoad) {
                        bestInstance = instances[i];
                        bestLoad = instances[i].cpu;
                    }
                }
                // No instance selected? Choose the random one
                if (!bestInstance) {
                    var keys = Object.keys(instances);
                    bestInstance = instances[keys[keys.length * Math.random() << 0]];
                }
                // Store instance to Stream data
                streamObject.mediaInstance = bestInstance.host;
                streamObject.save(() => {
                    self.cacheInstanceForRoom[room] = bestInstance;
                    // Return selected insance
                    return callback(null, bestInstance);
                });
            });
        });
    }

    /**
    * Get list of available Janus instances
    *
    * @return bool
    */
    getAvailableJanusInstances() {
        var self = this;
        clearInterval(self.instanceCheckerInterval);
        // Get instances from config file
        self.janusInstancesLoad(true, (err, instances, lock) => {
            instances = instances ? instances : {};
            for (let i in config.janus) {
                var instance = config.janus[i];
                if (!instance.enabled) {
                    continue;
                }
                // Store it to main server module
                if (!instances[instance.host]) {
                    instances[instance.host] = instance;
                }
            }
            self.janusInstancesSave(instances, () => {
                // Prepare instance
                if (lock) {
                    lock.unlock();
                }
                for(let i in instances) {
                    setTimeout(() => {
                        self.janusInstancePrepare(instances[i]);
                    }, i*500);
                }
                // check janus instances load
                self.instanceCheckerInterval = setInterval(() => {
                    for(let i in instances) {
                        var instance = instances[i];
                        if (instance.responderSocket) {
                            instance.responderSocket.emit('cpu');
                        }
                    }
                }, 5000);
            });
        });
    }

    /**
    * Prepare media instance — start responder socket and endpoint socket
    *
    * @param instance Object        Instance item
    * @return bool
    */
    janusInstancePrepare(instance) {
        var self = this;
        if (!instance) {
            return false;
        }
        // Set start CPU value. If no value will be returned from responder, this one will be used.
        // As it's extremely big, no calls will be pointet into it if any better instance exists
        instance.cpu = 100000;
        instance.connected = false;
        // connection to Janus server responder
        instance.responderSocket = require('socket.io-client')(instance.responder);
        // Process load average data from responder
        instance.responderSocket.on('cpu', data => {
            self.janusInstancesLoad(true, (err, instances, lock) => {
                instances[instance.host].cpu = Math.round(100 * (data.data.loadAverage - 0));
                self.janusInstancesSave(instances, () => {
                    lock.unlock();
                });
            });
        });
        instance.responderSocket.on('connect', data => {
            Log.message('Media server responder connected: ' + instance.host);
            instance.responderSocket.emit('cpu');
        });
        instance.responderSocket.on('disconnect', data => {
            setTimeout(() => {
                instance.responderSocket.connect(instance.responder);
            }, 5000);
        });
        // connection to Janus endpoint
        instance.endpointSocket = new WebSocketClient();
        instance.endpointSocket.on('connect', connection => {
            Log.message('Janus connected: ' + instance.host);
            self.janusInstancesLoad(true, (err, instances, lock) => {
                instances[instance.host].connected = true;
                self.janusInstancesSave(instances, () => {
                    lock.unlock();
                });
            });

            connection.on('close', data => {
                Log.error('Janus at ' + instance.host + ' is down');
                self.janusInstancesLoad(true, (err, instances, lock) => {
                    instances[instance.host].connected = false;
                    self.janusInstancesSave(instances, () => {
                        lock.unlock();
                    });
                });

                // If instance goes down, we need to change instance for all streams,
                // pointed into it. So clients can recoonect right after Janus instance fall to new one
                // Get all streams
                Server.server.redisClient.hgetall(config.redis.streamList, (error, steams) => {
                    if (error) {
                        return false;
                    }
                    for (let room in steams) {
                        try {
                            var data = JSON.parse(room);
                        } catch(e) {return false;}
                        // Load stream
                        new Stream().load(data, (err, streamObject) => {
                            if (err) {
                                return false;
                            }
                            //
                            self.getInstanceForRoom(room, (err, instanceForRoom) => {
                                // If stream is connected to this instance - remove instance data form Stream and cache
                                if (instanceForRoom.host == instance.host) {
                                    streamObject.mediaInstance = null;
                                    streamObject.save();
                                    delete self.cacheInstanceForRoom[room];
                                }
                            });
                        });
                    }
                });
            });
        });
        instance.endpointSocket.on('connectFailed', function(error) {
            Log.error('Can`t connect to Janus at ' + instance.host);
            console.log('Connect Error: ' + error.toString());
        });
        instance.endpointSocket.connect(instance.endpoint, 'janus-protocol');
        setInterval(() => {
            self.janusInstancesLoad(false, (err, instances, lock) => {
                if (!instances[instance.host].connected) {
                    instance.endpointSocket.connect(instance.endpoint, 'janus-protocol');
                }
            });
        }, 5000);
    }

    /**
    * Save Janus instances to Redis
    *
    * @return bool
    */
    janusInstancesSave(instances, callback) {
        var self = this;
        callback = callback ? callback : () => {};
        var toStore = {};
        if (!instances) {
            return callback('Nothing to save');
        }
        toStore = JSON.stringify(instances);
        Server.server.redisClient.set(config.redis.janusInstanceList, toStore, (err) => {
            callback(err);
        });
    }

    /**
    * Load Janus instances from Redis
    *
    * @return bool
    */
    janusInstancesLoad(lockIt, callback) {
        var self = this;
        Server.server.redlock.lock('janusInstanceListLock', 1000).then(function(lock) {
            if (!lockIt) {
                lock.unlock();
            }
            Server.server.redisClient.get(config.redis.janusInstanceList, (err, data) => {
                if (data) {
                    data = JSON.parse(data);
                    if (data) {
                        return callback(null, data, lock);
                    } else {
                        Log.error('Error parsing Janus instance list');
                        return callback('Error parsing Janus instance list');
                    }
                } else {
                    Log.message('No janus instances found');
                    return callback('No janus instances found');
                }
            });
        });
    }

    /**
    * Get room slug for Stream
    *
    * @return string
    */
    getRoomByStream(streamObject) {
        return streamObject.id;
    }

    /**
    * Request to Janus API
    *
    * @param method     sting       GET or POST, default is POST
    * @param instances  Object      Instance object
    * @param url        string      URL to request
    * @param params     array       Array of params to send
    * @param callback   function    Callback function
    * @return bool
    */
    request(method, instance, url, params, callback) {
        var self = this;
        if (method == 'POST') {
            if (instance.apiSecret) {
                params["apisecret"] = instance.apiSecret;
            }
            var options = {
                method: method ? method : 'POST',
                uri: instance.host + url,
                json: params,
                rejectUnauthorized: false
            };
        } else {
            var options = {
                method: 'GET',
                uri: instance.host + url + '?apisecret=' + instance.apiSecret,
                rejectUnauthorized: false
            };
        }
        request(options, (error, response, body) => {
            if (error) {
                try {
                    params = JSON.stringify(params);
                } catch(e) {};
                Log.error('Janus request error: ' + error + ', method:' + method +  ', url:' + url + ', params:' + params);
		return false;
            }
            if (callback) {
                return callback(body);
            }
        });
    };
}

module.exports = new Janus();
