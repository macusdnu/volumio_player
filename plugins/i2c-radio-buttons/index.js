'use strict';

const fs = require("fs");
const i2c = require("i2c-bus");
const libQ = require('kew');
const VConf = require('v-conf');

module.exports = RadioButtons;

function RadioButtons(context) {
    this.context = context;
    this.commandRouter = context.coreCommand;
    this.logger = this.commandRouter.logger;

    // Correct config load
    this.config = new VConf();
    this.configFile = this.commandRouter.pluginManager.getConfigurationFile(this.context, 'config.json');
    this.config.loadFile(this.configFile);
    this.logger.info("[RadioButtons] using config file: " + this.configFile);
    this.logger.info("[RadioButtons] Loaded config data: " + JSON.stringify(this.config.data));
    this.logger.info("[RadioButtons] Test get 'pcf8575_addr': " + this.config.get('pcf8575_addr'));

    // Migration for flat config files
    try {
        if (this.config.data.pcf8575_addr && typeof this.config.data.pcf8575_addr !== 'object') {
            this.logger.info("[RadioButtons] Detected flat config file, migrating to v-conf structure...");
            const flatData = JSON.parse(JSON.stringify(this.config.data));
            this.config.data = {};

            for (const key in flatData) {
                this.config.set(key, flatData[key]);
            }
            this.config.save();
            this.logger.info("[RadioButtons] Migration complete.");
        }
    } catch (e) {
        this.logger.error("[RadioButtons] Migration error: " + e);
    }

    this.i2cBus = null;
    this.pollTimer = null;
    this.lastState = 0xFFFF;
}

RadioButtons.prototype.onStart = function () {
    const defer = libQ.defer();

    // Reload config on start to ensure freshness
    this.logger.info("[RadioButtons] onStart: Reloading config file from " + this.configFile);

    try {
        const fileContent = fs.readFileSync(this.configFile, 'utf8');
        this.logger.info("[RadioButtons] onStart: File content raw: " + fileContent);
    } catch (e) {
        this.logger.error("[RadioButtons] onStart: Failed to read file manually: " + e);
    }

    this.config.loadFile(this.configFile);
    this.logger.info("[RadioButtons] onStart: v-conf data after load: " + JSON.stringify(this.config.data));

    const pcfEnabled = this.config.get("pcf8575_enabled");
    this.logger.info(`[RadioButtons] onStart pcf8575_enabled: ${pcfEnabled} (type: ${typeof pcfEnabled})`);

    if (pcfEnabled === true || pcfEnabled === "true") {
        this.initPCF8575();
    }

    this.logger.info("Radio Buttons plugin started");
    defer.resolve();
    return defer.promise;
};

RadioButtons.prototype.onStop = function () {
    const defer = libQ.defer();

    try {
        if (this.pollTimer) clearInterval(this.pollTimer);
        this.pollTimer = null;

        if (this.i2cBus) {
            this.i2cBus.closeSync();
            this.i2cBus = null;
        }

        this.logger.info("Radio Buttons plugin stopped");
        defer.resolve();
    }
    catch (error) {
        this.logger.error("Error during onStop(): " + error);
        defer.reject(error);
    }

    return defer.promise;
};

RadioButtons.prototype.getConfigurationFiles = function () {
    return ['config.json'];
};

RadioButtons.prototype.getUIConfig = function () {
    const lang_code = this.commandRouter.sharedVars.get('language_code');

    return this.commandRouter.i18nJson(
        __dirname + '/i18n/strings_' + lang_code + '.json',
        __dirname + '/UIConfig.json',
        __dirname + '/UIConfig.json'
    ).then((uiconf) => {
        // Ensure config is fresh
        this.config.loadFile(this.configFile);

        const favouritesFile = "/data/favourites/radio-favourites";
        let stations = [];

        try {
            const favData = JSON.parse(fs.readFileSync(favouritesFile, "utf8"));

            if (Array.isArray(favData)) {
                stations = favData.map(r => ({
                    label: r.title,
                    value: r.uri
                }));
            }

        } catch (e) {
            this.logger.error("Failed loading favourites: " + e);
        }

        if (stations.length === 0) {
            stations = [{ label: "No Favourite Radios Found", value: "" }];
        }

        // Populate button dropdowns
        const buttonSection = uiconf.sections[1];
        this.logger.info(`[RadioButtons] getUIConfig sections[1].id: ${buttonSection.id}`);

        // NOW 10 buttons
        for (let i = 1; i <= 10; i++) {
            const field = buttonSection.content[i - 1];
            field.options = stations;

            const saved = this.config.get(`button${i}_station`);
            const match = stations.find(s => s.value === saved);

            this.logger.info(`[RadioButtons] Button ${i} (id: ${field.id}): Saved='${saved}'. Match found: ${match ? 'YES' : 'NO'}`);

            if (match) {
                field.value = match;
            } else if (saved) {
                field.value = { label: saved, value: saved };
            }
        }

        // PCF settings
        let pcfEnabled = this.config.get("pcf8575_enabled");
        if (pcfEnabled === "true") pcfEnabled = true;
        if (pcfEnabled === "false") pcfEnabled = false;

        const pcfAddr = this.config.get("pcf8575_addr");

        this.logger.info(`[RadioButtons] getUIConfig: pcfEnabled=${pcfEnabled} (type ${typeof pcfEnabled}), pcfAddr=${pcfAddr}`);

        uiconf.sections[0].content[0].value = pcfEnabled;
        uiconf.sections[0].content[1].value = pcfAddr;

        return uiconf;
    });
};

RadioButtons.prototype.saveRadioButtonsConfig = function (data) {
    const defer = libQ.defer();

    try {
        this.logger.info("[RadioButtons] saveRadioButtonsConfig received data: " + JSON.stringify(data));
        // NOW 10 buttons
        for (let i = 1; i <= 10; i++) {
            const key = `button${i}_station`;
            let val = data[key];

            if (val === undefined) {
                val = "";
            } else if (typeof val === 'object' && val !== null && val.value) {
                val = val.value;
            }
            this.logger.info(`[RadioButtons] saveRadioButtonsConfig() setting ${key} = ${val}`);
            this.config.set(key, val);
        }

        // *** Force write to disk ***
        this.logger.info("[RadioButtons] internal config data: " + JSON.stringify(this.config.data));
        this.logger.info("[RadioButtons] saving to file: " + this.config.filePath);
        this.config.save();
        this.logger.info("[RadioButtons] saveRadioButtonsConfig() config saved to disk");

        this.commandRouter.pushToastMessage("success", "Radio Buttons", "Station mapping saved");
        defer.resolve();
    }
    catch (e) {
        this.logger.error("saveRadioButtonsConfig error: " + e);
        defer.reject(e);
    }

    return defer.promise;
};

RadioButtons.prototype.savePCFConfig = function (data) {
    const defer = libQ.defer();

    try {
        // Normalize types coming from UI
        this.logger.info("[RadioButtons] savePCFConfig received data: " + JSON.stringify(data));

        let enabledVal = data.pcf8575_enabled;
        if (typeof enabledVal === 'object' && enabledVal !== null && enabledVal.value !== undefined) {
            enabledVal = enabledVal.value;
        }
        const enabled = (enabledVal === true || enabledVal === "true");

        let addrVal = data.pcf8575_addr;
        if (typeof addrVal === 'object' && addrVal !== null && addrVal.value !== undefined) {
            addrVal = addrVal.value;
        }
        const addr = ("" + addrVal).trim();

        this.logger.debug(`[RadioButtons] savePCFConfig() parsed enabled=${enabled}, addr=${addr}`);

        // Update v-conf
        this.config.set("pcf8575_enabled", enabled);
        this.config.set("pcf8575_addr", addr);

        // *** Force write to disk ***
        this.logger.info("[RadioButtons] savePCFConfig internal data: " + JSON.stringify(this.config.data));
        this.config.save();
        this.logger.info("[RadioButtons] savePCFConfig() config saved to disk");

        // Apply runtime behavior
        if (enabled) {
            this.initPCF8575();
        } else {
            if (this.pollTimer) {
                clearInterval(this.pollTimer);
            }
            this.pollTimer = null;

            if (this.i2cBus) {
                this.i2cBus.closeSync();
                this.i2cBus = null;
            }
        }

        this.commandRouter.pushToastMessage("success", "PCF8575 Settings", "Configuration saved");
        defer.resolve();
    }
    catch (e) {
        this.logger.error("savePCFConfig error: " + e);
        defer.reject(e);
    }

    return defer.promise;
};

RadioButtons.prototype.initPCF8575 = function () {
    const rawAddr = this.config.get("pcf8575_addr");
    this.logger.info(`[RadioButtons] initPCF8575 raw addr: ${rawAddr} (type: ${typeof rawAddr})`);
    const addr = parseInt(rawAddr, 16);

    try {
        this.i2cBus = i2c.openSync(1);
        this.logger.info(`PCF8575 initialized at 0x${addr.toString(16)}`);

        // Initial read to set lastState matches reality
        const buf = Buffer.alloc(2);
        this.i2cBus.readI2cBlockSync(addr, 0x00, 2, buf);

        // Correct packing: buf[0] = P0–P7, buf[1] = P8–P15
        this.lastState = buf[0] | (buf[1] << 8);
        this.logger.info(`[RadioButtons] Initial PCF8575 state: 0x${this.lastState.toString(16)}`);

    } catch (e) {
        this.logger.error("PCF8575 init error: " + e);
        return;
    }

    this.pollTimer = setInterval(() => this.pollButtons(addr), 150);
};

RadioButtons.prototype.pollButtons = function (addr) {
    if (!this.i2cBus) return;

    try {
        const buf = Buffer.alloc(2);
        this.i2cBus.readI2cBlockSync(addr, 0x00, 2, buf);

        // Correct packing: buf[0] = P0–P7, buf[1] = P8–P15
        const state = buf[0] | (buf[1] << 8);

        // Use 10 inputs: P0–P9 → buttons 1–10
        for (let i = 0; i < 10; i++) {
            const mask = 1 << i;

            if ((state & mask) === 0 && (this.lastState & mask) !== 0) {
                this.logger.info(
                    `[RadioButtons] Button ${i + 1} detected (State: ${state.toString(2)}, Last: ${this.lastState.toString(2)})`
                );
                this.onButtonPress(i + 1);
            }
        }

        this.lastState = state;

    } catch (e) {
        this.logger.error("PCF8575 poll error: " + e);
    }
};

RadioButtons.prototype.onButtonPress = function (num) {
    const uri = this.config.get(`button${num}_station`);

    if (!uri) {
        this.logger.warn(`Button ${num} pressed but has no assigned station.`);
        return;
    }

    this.logger.info(`Button ${num} → Play ${uri}`);

    this.commandRouter.pushToastMessage("info", "Radio Button", `Playing Button ${num}`);

    this.commandRouter.replaceAndPlay({
        service: "webradio",
        type: "webradio",
        title: "Button " + num,
        uri: uri
    });
};
