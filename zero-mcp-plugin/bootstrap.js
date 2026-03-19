var ZeroMcpPlugin;

function install() {}

async function startup({ id, version, rootURI }) {
	try {
		Services.scriptloader.loadSubScript(rootURI + 'plugin-compat.js');
		await Zotero.PreferencePanes.register({
			pluginID: id,
			id: 'zero-mcp-plugin-preferences',
			label: 'Zotero Copilot',
			src: 'preferences.xhtml',
			scripts: ['plugin-compat.js', 'preferences.js']
		});
	}
	catch (error) {
		Zotero.logError(error);
		throw error;
	}

	Services.scriptloader.loadSubScript(rootURI + 'plugin-main.js');
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

async function shutdown() {
	if (ZeroMcpPlugin) {
		try {
			await ZeroMcpPlugin.shutdown();
		}
		finally {
			ZeroMcpPlugin = undefined;
		}
	}
}

function uninstall() {}
