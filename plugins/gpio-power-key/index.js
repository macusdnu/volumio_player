'use strict';

var libQ = require('kew');
var fs = require('fs-extra');
var Gpio = require('onoff').Gpio;
var io = require('socket.io-client');
var socket = io.connect('http://localhost:3000');
var actions = ["shutdown"];

module.exports = GPIOPower;

function GPIOPower(context) {
	var self = this;
	self.context=context;
	self.commandRouter = self.context.coreCommand;
	self.logger = self.context.logger;
	self.triggers = [];
}


GPIOPower.prototype.onVolumioStart = function () {
	var self = this;

	var configFile=this.commandRouter.pluginManager.getConfigurationFile(this.context,'config.json');
	this.config = new (require('v-conf'))();
	this.config.loadFile(configFile);

	self.logger.info("GPIO-Buttons initialized");
	
	return libQ.resolve();	
};


GPIOPower.prototype.getConfigurationFiles = function()
{
	return ['config.json'];
};


GPIOPower.prototype.onStart = function () {
	var self = this;
	var defer=libQ.defer();

	self.createTriggers()
		.then (function (result) {
			self.logger.info("GPIO-Buttons started");
			defer.resolve();
		});
	
    return defer.promise;
};


GPIOPower.prototype.onStop = function () {
	var self = this;
	var defer=libQ.defer();

	self.clearTriggers()
		.then (function (result) {
			self.logger.info("GPIO-Buttons stopped");
			defer.resolve();
		});
	
    return defer.promise;
};


GPIOPower.prototype.onRestart = function () {
	var self = this;
};

GPIOPower.prototype.onInstall = function () {
	var self = this;
};

GPIOPower.prototype.onUninstall = function () {
	var self = this;
};

GPIOPower.prototype.getConf = function (varName) {
	var self = this;
};

GPIOPower.prototype.setConf = function(varName, varValue) {
	var self = this;
};

GPIOPower.prototype.getAdditionalConf = function (type, controller, data) {
	var self = this;
};

GPIOPower.prototype.setAdditionalConf = function () {
	var self = this;
};

GPIOPower.prototype.setUIConfig = function (data) {
	var self = this;
};


GPIOPower.prototype.getUIConfig = function () {
	var defer = libQ.defer();
	var self = this;

	self.logger.info('GPIO-Buttons: Getting UI config');

	//Just for now..
	var lang_code = 'en';

	//var lang_code = this.commandRouter.sharedVars.get('language_code');

        self.commandRouter.i18nJson(__dirname+'/i18n/strings_'+lang_code+'.json',
                __dirname+'/i18n/strings_en.json',
                __dirname + '/UIConfig.json')
        .then(function(uiconf)
        {

			var i = 0;
			actions.forEach(function(action, index, array) {
 				
 				// Strings for config
				var c1 = action.concat('.enabled');
				var c2 = action.concat('.pin');
				
				// accessor supposes actions and uiconfig items are in SAME order
				// this is potentially dangerous: rewrite with a JSON search of "id" value ?				
				uiconf.sections[0].content[2*i].value = self.config.get(c1);
				uiconf.sections[0].content[2*i+1].value.value = self.config.get(c2);
				uiconf.sections[0].content[2*i+1].value.label = self.config.get(c2).toString();

				i = i + 1;
			});

            defer.resolve(uiconf);
		})
        .fail(function()
        {
            defer.reject(new Error());
        });

        return defer.promise;
};


GPIOPower.prototype.saveConfig = function(data)
{
	var self = this;

	actions.forEach(function(action, index, array) {
 		// Strings for data fields
		var s1 = action.concat('Enabled');
		var s2 = action.concat('Pin');

		// Strings for config
		var c1 = action.concat('.enabled');
		var c2 = action.concat('.pin');
		var c3 = action.concat('.value');

		self.config.set(c1, data[s1]);
		self.config.set(c2, data[s2]['value']);
		self.config.set(c3, 0);
	});

	self.clearTriggers()
		.then(self.createTriggers());

	self.commandRouter.pushToastMessage('success',"GPIO-Buttons", "Configuration saved");
};


GPIOPower.prototype.createTriggers = function() {
	var self = this;

	self.logger.info('GPIO-Buttons: Reading config and creating triggers...');

	actions.forEach(function(action, index, array) {
		var c1 = action.concat('.enabled');
		var c2 = action.concat('.pin');

		var enabled = self.config.get(c1);
		var pin = self.config.get(c2);

		if(enabled === true){
			self.logger.info('GPIO-Buttons: '+ action + ' on pin ' + pin);
			var j = new Gpio(pin,'in','rising', {debounceTimeout: 250});
			j.watch(self.listener.bind(self,action));
			self.triggers.push(j);
		}
	});
		
	return libQ.resolve();
};


GPIOPower.prototype.clearTriggers = function () {
	var self = this;
	
	self.triggers.forEach(function(trigger, index, array) {
  		self.logger.info("GPIO-Buttons: Destroying trigger " + index);

		trigger.unwatchAll();
		trigger.unexport();		
	});
	
	self.triggers = [];

	return libQ.resolve();	
};


GPIOPower.prototype.listener = function(action,err,value){
	var self = this;
	
	// we now debounce the button, so no need to check for the value
	self[action]();
};

//shutdown
GPIOPower.prototype.shutdown = function() {
  // this.logger.info('GPIO-Buttons: shutdown button pressed\n');
  this.commandRouter.shutdown();
};
