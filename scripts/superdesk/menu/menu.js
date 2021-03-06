SuperdeskFlagsService.$inject = ['config'];
function SuperdeskFlagsService(config) {
    this.flags = {
        menu: false,
        notifications: false
    };

    angular.extend(this.flags, config.ui);
}

angular.module('superdesk.menu', [
    'superdesk.menu.notifications',
    'superdesk.privileges',
    'superdesk.asset',
    'superdesk.api'
])

    .service('superdeskFlags', SuperdeskFlagsService)

    // set flags for other directives
    .directive('sdSuperdeskView', ['asset', function(asset) {

        SuperdeskViewController.$inject = ['superdeskFlags'];

        function SuperdeskViewController(superdeskFlags) {
            this.flags = superdeskFlags.flags;
        }

        return {
            templateUrl: asset.templateUrl('superdesk/menu/views/superdesk-view.html'),
            controller: SuperdeskViewController,
            controllerAs: 'superdesk'
        };
    }])

    .directive('sdMenuWrapper', [
        '$route',
        'superdesk',
        'betaService',
        'userNotifications',
        'asset',
        'privileges',
        'config',
        'lodash',
        function ($route, superdesk, betaService, userNotifications, asset, privileges, config, _) {
            return {
                require: '^sdSuperdeskView',
                templateUrl: asset.templateUrl('superdesk/menu/views/menu.html'),
                link: function (scope, elem, attrs, ctrl) {

                    scope.currentRoute = null;
                    scope.flags = ctrl.flags;
                    scope.menu = [];
                    scope.isTestEnvironment = config.isTestEnvironment;
                    scope.environmentName = config.environmentName;

                    superdesk.getMenu(superdesk.MENU_MAIN)
                            .then(filterSettingsIfEmpty)
                            .then(function (menu) {
                                scope.menu = menu;
                                setActiveMenuItem($route.current);
                            });

                    function filterSettingsIfEmpty(menu) {
                        return superdesk.getMenu(superdesk.MENU_SETTINGS).then(function (settingsMenu) {
                            if (!settingsMenu.length) {
                                _.remove(menu, {_settings: 1});
                            }

                            return menu;
                        });
                    }

                    scope.toggleMenu = function () {
                        ctrl.flags.menu = !ctrl.flags.menu;
                    };

                    scope.toggleNotifications = function () {
                        ctrl.flags.notifications = !ctrl.flags.notifications;
                    };

                    scope.toggleBeta = function () {
                        betaService.toggleBeta();
                    };

                    function setActiveMenuItem(route) {
                        _.each(scope.menu, function (activity) {
                            activity.isActive = route && route.href &&
                                    route.href.substr(0, activity.href.length) === activity.href;
                        });
                    }

                    scope.$on('$locationChangeStart', function () {
                        ctrl.flags.menu = false;
                    });

                    scope.$watch(function currentRoute() {
                        return $route.current;
                    }, function (route) {
                        scope.currentRoute = route || null;
                        setActiveMenuItem(scope.currentRoute);
                        ctrl.flags.workspace = route ? !!route.sideTemplateUrl : false;
                    });

                    scope.notifications = userNotifications;

                    privileges.loaded.then(function () {
                        scope.privileges = privileges.privileges;
                    });

                    scope.openAbout = function () {
                        scope.aboutActive = true;
                    };
                    scope.closeAbout = function () {
                        scope.aboutActive = false;
                    };
                }
            };
        }])
    .directive('sdAbout', ['asset', 'config', 'api', function (asset, config, api) {
        return {
            templateUrl: asset.templateUrl('superdesk/menu/views/about.html'),
            link: function(scope) {

                api.query('backend_meta', {}).then(
                    function(metadata)
                    {
                        scope.build_rev = metadata.meta_rev;
                        scope.build_rev_core = metadata.meta_rev_core;
                        scope.build_rev_client = metadata.meta_rev_client;
                    });
                scope.version = config.version;
                scope.year = (new Date()).getUTCFullYear();
                scope.releaseDate = config.releaseDate;
            }
        };
    }]);
