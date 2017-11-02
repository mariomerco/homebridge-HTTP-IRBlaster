"use strict";

var debug = require('debug')('IrBlaster');
var request = require("request");
var Service, Characteristic;

module.exports = function(homebridge) {

  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;

  homebridge.registerAccessory("homebridge-http-irblaster", "http-irblaster", IrBlaster);
}

function IrBlaster(log, config) {
  this.log = log;
  this.name = config.name;
  this.stateful = config.stateful;
  this.url = config.url;
  this.on_busy = config.on_busy || 1;
  this.off_busy = config.off_busy || 1;
  this.down_busy = config.down_busy || 1;
  this.up_busy = config.up_busy || 1;
  this.rdelay = config.rdelay || 200;
  this.on_data = config.on_data;
  this.off_data = config.off_data;
  this.up_data = config.up_data;
  this.down_data = config.down_data;
  this.start = config.start;
  this.steps = config.steps;

  this.working = Date.now();

  if (this.on_data) {

    if (this.up_data) {
      // On/Off and up/down type device
      //   this.addOptionalCharacteristic(Characteristic.RotationSpeed);
      debug("Adding Fan", this.name);
      this._service = new Service.Fan(this.name);
      this._service.getCharacteristic(Characteristic.On)
        .on('set', this._setState.bind(this));

      // Using RotationSpeed as a placeholder for up/down control

      this._service
        .addCharacteristic(new Characteristic.RotationSpeed())
        .on('set', this._setSpeed.bind(this));

      if (this.start) {
        this._service.getCharacteristic(Characteristic.RotationSpeed).updateValue(this.start);
      }

    } else {
      // Statefull on/off
      debug("Adding Stateful switch", this.name);
      this._service = new Service.Switch(this.name);
      this._service.getCharacteristic(Characteristic.On)
        .on('set', this._setState.bind(this));
    }
  } else {
    // Toggle switch
    debug("Adding toggle switch", this.name);
    this._service = new Service.Switch(this.name);
    this._service.getCharacteristic(Characteristic.On)
      .on('set', this._setOn.bind(this));
  }
}

IrBlaster.prototype.getServices = function() {
  return [this._service];
}

IrBlaster.prototype._setSpeed = function(value, callback) {

  //debug("Device", this._service);

  this.log("Setting " + this.name + " to " + value);

  var current = this._service.getCharacteristic(Characteristic.RotationSpeed)
    .value;

  if (current == undefined)
    current = this.start;

  var _value = Math.floor(value / (100 / this.steps));
  var _current = Math.floor(current / (100 / this.steps));
  var delta = Math.round(_value - _current);

  debug("Values", this.name, value, current, delta);

  if (delta < 0) {
    // Turn down device
    this.log("Turning down " + this.name + " by " + Math.abs(delta));
    this.httpRequest("down", this.url, this.down_data, Math.abs(delta), this.down_busy, function(error, response, responseBody) {
      if (error) {
        this.log('IR Blast failed: %s', error.message);
        callback(error);
      } else {
        debug('IR Blast succeeded!', this.url);
        callback();
      }
    }.bind(this));
  } else if (delta > 0) {

    // Turn up device
    this.log("Turning up " + this.name + " by " + Math.abs(delta));
    this.httpRequest("up", this.url, this.up_data, Math.abs(delta), this.up_busy, function(error, response, responseBody) {
      if (error) {
        this.log('IR Blast failed: %s', error.message);
        callback(error);
      } else {
        debug('IR Blast succeeded!', this.url);
        callback();
      }
    }.bind(this));

  } else {
    this.log("Not controlling " + this.name, value, current, delta);
    callback();
  }
}


IrBlaster.prototype._setOn = function(on, callback) {

  this.log("Setting " + this.name + " to " + on);

  if (on && !this.stateful) {
    setTimeout(function() {
      this._service.setCharacteristic(Characteristic.On, 0);
    }.bind(this), this.busy * 1000);
  }

  if (on) {
    this.httpRequest("toggle", this.url, this.data, 1, this.on_busy, function(error, response, responseBody) {
      if (error) {
        this.log('IR Blast failed: %s', error.message);
        callback(error);
      } else {
        debug('IR Blast succeeded!', this.url);
        callback();
      }
    }.bind(this));
  } else {
    callback();
  }
}

// An actual on/off switch

IrBlaster.prototype._setState = function(on, callback) {

  this.log("Turning " + this.name + " to " + on);

  debug("_setState", this.name, on, this._service.getCharacteristic(Characteristic.On).value);

  if (on && !this._service.getCharacteristic(Characteristic.On).value) {
    this.httpRequest("on", this.url, this.on_data, 1, this.on_busy, function(error, response, responseBody) {
      if (error) {
        this.log('IR Blast failed: %s', error.message);
        callback(error);
      } else {
        debug('IR Blast succeeded!', this.url);
        var current = this._service.getCharacteristic(Characteristic.RotationSpeed)
          .value;
        if (current != this.start) {
          debug("Setting level after turning on ", this.start);
          this._service.getCharacteristic(Characteristic.RotationSpeed).updateValue(this.start);
        }
        callback();
      }
    }.bind(this));
  } else if (!on && this._service.getCharacteristic(Characteristic.On).value) {
    this.httpRequest("off", this.url, this.off_data, 1, this.off_busy, function(error, response, responseBody) {
      if (error) {
        this.log('IR Blast failed: %s', error.message);
        callback(error);
      } else {
        debug('IR Blast succeeded!', this.url);
        callback();
      }
    }.bind(this));
  } else {
    debug("Do nothing");
    callback();
  }
}

IrBlaster.prototype.httpRequest = function(name, url, data, count, sleep, callback) {
  //debug("url",url,"Data",data);
  // Content-Length is a workaround for a bug in both request and ESP8266WebServer - request uses lower case, and ESP8266WebServer only uses upper case

  debug("HttpRequest", name, url, count, sleep, callback);

  //debug("time",Date.now()," ",this.working);

  if (Date.now() > this.working) {
    this.working = Date.now() + sleep * count;

    if (data) {

      data[0].repeat = count;
      data[0].rdelay = this.rdelay;

      var body = JSON.stringify(data);
      //debug("Body", body);
      request({
          url: url,
          method: "POST",
          timeout: 5000,
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': body.length
          },
          body: body
        },
        function(error, response, body) {
          if (response) {
            debug("Response", response.statusCode, response.statusMessage);
          } else {
            debug("Error", name, url, count, sleep, callback, error);
          }

          if (callback) callback(error, response, body);
        }.bind(this));
    } else {
      // Simple URL Format
      request({
          url: url,
          method: "GET",
          timeout: 500
        },
        function(error, response, body) {
          if (response) {
            debug("Response", response.statusCode, response.statusMessage);
          } else {
            debug("Error", error);
          }

          if (callback) callback(error, response, body);
        })
    }
  } else {
    debug("NODEMCU is busy", name);
    if (callback) callback(new Error("Device Busy"));
  }
}
