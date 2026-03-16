var ZeroMcpPlugin;

function install() {}

async function startup({ id, version, rootURI }) {
	try {
		Zotero.PreferencePanes.register({
			pluginID: 'zero-mcp-plugin@example.com',
			src: 'preferences.xhtml',
			scripts: ['preferences.js']
		});
	}
	catch (error) {
		Zotero.logError(error);
		throw error;
	}

	Services.scriptloader.loadSubScript(rootURI + 'zero-mcp-plugin.js');
	ZeroMcpPlugin.init({ id, version, rootURI });
	await ZeroMcpPlugin.startup();
}

function onMainWindowLoad({ window }) {
	if (ZeroMcpPlugin && ZeroMcpPlugin.onMainWindowLoad) {
		ZeroMcpPlugin.onMainWindowLoad({ window });
	}
}

function onMainWindowUnload({ window }) {
	if (ZeroMcpPlugin && ZeroMcpPlugin.onMainWindowUnload) {
		ZeroMcpPlugin.onMainWindowUnload({ window });
	}
}

function shutdown() {
	if (ZeroMcpPlugin) {
		ZeroMcpPlugin.shutdown();
		ZeroMcpPlugin = undefined;
	}
}

function uninstall() {}
