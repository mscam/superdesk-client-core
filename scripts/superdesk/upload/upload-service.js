angular.module('superdesk.upload.upload', []).service('upload', ['$q', 'Upload', function ($q, Upload) {
    /**
     * Start upload
     *
     * @param {Object} config
     * @returns Promise
     */
    this.start = function(config) {
        config.isUpload = true;
        return Upload.upload(config);
    };

    /**
     * Restart upload
     *
     * @param {Object} config
     * @returns {Promise}
     */
    this.restart = function(config) {
        return Upload.http(config);
    };

    /**
     * Test if given request config is an upload
     *
     * @param {Object} config
     * @returns {bool}
     */
    this.isUpload = function(config) {
        return config.isUpload || false;
    };
}]);
