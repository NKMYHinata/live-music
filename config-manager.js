const fs = require('fs-extra');
const path = require('path');
const os = require('os');

// Default configuration
const DEFAULT_CONFIG = {
    proxyPort: 8001,
    webInterfacePort: 8002,
    uiPort: 8003,
    neteasePort: 8001, // Alias for proxyPort as per user request
    infoPort: 8003     // Alias for uiPort as per user request
};

class ConfigManager {
    constructor(userDataPath) {
        this.configPath = path.join(userDataPath || process.cwd(), 'config.json');
        this.config = { ...DEFAULT_CONFIG };
        this.load();
    }

    load() {
        try {
            if (fs.existsSync(this.configPath)) {
                const data = fs.readJsonSync(this.configPath);
                this.config = { ...DEFAULT_CONFIG, ...data };
            } else {
                this.save();
            }
        } catch (error) {
            console.error('Error loading config:', error);
        }
        return this.config;
    }

    save(newConfig) {
        if (newConfig) {
            this.config = { ...this.config, ...newConfig };
        }
        try {
            fs.writeJsonSync(this.configPath, this.config, { spaces: 2 });
            console.log('Config saved to:', this.configPath);
        } catch (error) {
            console.error('Error saving config:', error);
        }
    }

    get() {
        return this.config;
    }
}

module.exports = ConfigManager;
