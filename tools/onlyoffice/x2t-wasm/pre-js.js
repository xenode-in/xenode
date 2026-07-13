Module.noInitialRun = true;
Module.noExitRuntime = true;
(function() {
	let suffix;
	if (typeof document != 'undefined') {
		const myScript = document.currentScript;
		const mySrc = myScript.getAttribute('src');
		suffix = new URL(mySrc).search;
	} else {
		suffix = '';
	}

	Module.locateFile = function(path, prefix) {
		return prefix + path + suffix;
	};
})();
