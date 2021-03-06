/**
 * This file is part of Superdesk.
 *
 * Copyright 2013, 2014 Sourcefabric z.u. and contributors.
 *
 * For the full copyright and license information, please see the
 * AUTHORS and LICENSE files distributed with this source code, or
 * at https://www.sourcefabric.org/superdesk/license
 */
var TYPING_CLASS = 'typing';

/**
 * Escape given string for reg exp
 *
 * @url https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_Expressions
 *
 * @param {string} string
 * @return {string}
 */
function escapeRegExp(string){
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Generate click event on given target node
 *
 * @param {Node} target
 */
function click(target) {
    target.dispatchEvent(new MouseEvent('click'));
}

/**
 * Replace given dom elem with its contents
 *
 * It is like jQuery unwrap
 *
 * @param {Node} elem
 */
function replaceSpan(elem) {
    var parent = elem.parentNode;
    while (elem.hasChildNodes()) {
        parent.insertBefore(elem.childNodes.item(0), elem);
    }

    parent.removeChild(elem);
}

/**
 * Remove all elements with given className but keep its contents
 *
 * @param {Node} elem
 * @param {string} className
 * @return {Node}
 */
function removeClass(elem, className) {
    var node = elem.cloneNode(true);
    var spans = node.getElementsByClassName(className);
    while (spans.length) {
        replaceSpan(spans.item(0));
    }

    node.normalize();
    return node;
}

/**
 * Find text node + offset for given node and offset
 *
 * This will find text node within given node that contains character on given offset
 *
 * @param {Node} node
 * @param {numeric} offset
 * @return {Object} {node: {Node}, offset: {numeric}}
 */
function findTextNode(node, offset) {
    var tree = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    var currentLength;
    var currentOffset = 0;
    var ZERO_WIDTH_SPACE = String.fromCharCode(65279);
    while (tree.nextNode()) {
        tree.currentNode.textContent = tree.currentNode.textContent.replace(ZERO_WIDTH_SPACE, '');
        currentLength = tree.currentNode.textContent.length;
        if (currentOffset + currentLength >= offset) {
            return {node: tree.currentNode, offset: offset - currentOffset};
        }

        currentOffset += currentLength;
    }
}

/**
 * History stack
 *
 * It supports undo/redo operations
 *
 * @param {string} initialValue
 */
function HistoryStack(initialValue) {
    var stack = [];
    var selectionStack = [];
    var index = -1;
    /**
     * Add a new value to stack and remove all furhter redo values
     * so after manual change there is no way to redo.
     *
     * @param {string} value
     */
    this.add = function(value, selection) {
        index = index + 1;
        stack[index] = value;
        selectionStack[index] = selection;
        stack.splice(index + 1, stack.length);
        selectionStack.splice(index + 1, selectionStack.length);
    };

    /**
     * Select previous value (undo)
     */
    this.selectPrev = function() {
        index = Math.max(-1, index - 1);
    };

    /**
     * Select next value (redo)
     */
    this.selectNext = function() {
        index = stack[index + 1] != null ? index + 1 : index;
    };

    /**
     * Get current index position
     */
    this.getIndex = function() {
        return index;
    };

    /**
     * Set initial value
     */
    this.setInitialValue = function(value) {
        initialValue = value;
    };

    /**
     * Get current value
     */
    this.get = function() {
        var state = index > -1 ? stack[index] : initialValue;
        return state;
    };

    /**
     * Get current cursor position
     */
    this.getSelection = function() {
        var selectionState = index > -1 ? selectionStack[index] : null;
        if (selectionState) {
            selectionState.restored = false;
        }

        return selectionState;
    };
}

EditorService.$inject = ['spellcheck', '$rootScope', '$timeout', '$q'];
function EditorService(spellcheck, $rootScope, $timeout, $q) {
    this.settings = {spellcheck: false};
    window.editor = this;

    this.KEY_CODES = Object.freeze({
        Y: 'Y'.charCodeAt(0),
        Z: 'Z'.charCodeAt(0)
    });

    this.ARROWS = Object.freeze({
        33: 1, // page up
        34: 1, // page down
        35: 1, // end
        36: 1, // home
        37: 1, // left
        38: 1, // up
        39: 1, // right
        40: 1  // down
    });

    this.META = Object.freeze({
        9: 1, // tab
        16: 1, // shift
        17: 1, // ctrl
        18: 1, // alt
        20: 1, // caps lock
        91: 1, // left meta in webkit
        93: 1, // right meta in webkit
        224: 1 // meta in firefox
    });

    /**
     * Test if given keyboard event should be ignored as it's not changing content.
     *
     * @param {Event} event
     * @return {boolen}
     */
    this.shouldIgnore = function (event) {
        // ignore arrows
        if (self.ARROWS[event.keyCode]) {
            return true;
        }

        // ignore meta keys (ctrl, shift or meta only)
        if (self.META[event.keyCode]) {
            return true;
        }

        // ignore shift + ctrl/meta + something
        if (event.shiftKey && (event.ctrlKey || event.metaKey)) {
            return true;
        }

        return false;
    };

    var ERROR_CLASS = 'sderror';
    var HILITE_CLASS = 'sdhilite';
    var ACTIVE_CLASS = 'sdactive';
    var FINDREPLACE_CLASS = 'sdfindreplace';

    var self = this;
    var scopes = [];

    /**
     * Register given scope - it adds history stack to it and keeps reference
     *
     * @param {Scope} scope
     */
    this.registerScope = function(scope) {
        scopes.push(scope);
        scope.history = new HistoryStack(scope.model.$viewValue);
        scope.$on('$destroy', function() {
            var index = scopes.indexOf(scope);
            scopes.splice(index, 1);
        });
    };

    /**
     * Remove highlighting from given scope and return its contents
     *
     * @param {Scope} scope
     * @return {string}
     */
    this.cleanScope = function(scope) {
        self.storeSelection(scope.node);
        var html = clean(scope.node).innerHTML;
        html = html.replace('\ufeff', ''); // remove rangy marker
        scope.node.innerHTML = html;
        self.resetSelection(scope.node);
        return html;
    };

    /**
     * Render highlights for given scope based on settings
     *
     * @param {Scope} scope
     * @param {Scope} force force rendering manually - eg. via keyboard
     */
    this.renderScope = function(scope, force, preventStore) {
        self.cleanScope(scope);
        if (self.settings.findreplace) {
            renderFindreplace(scope.node);
        } else if (self.settings.spellcheck || force) {
            renderSpellcheck(scope.node, preventStore);
        }
    };

    /**
     * Render highlights in all registered scopes
     *
     * @param {Boolean} force rendering
     */
    this.render = function(force) {
        scopes.forEach(function(scope) {
            self.renderScope(scope, force);
        });
    };

    /**
     * Remove highlight markup from given node
     *
     * @param {Node} node
     * @return {Node}
     */
    function clean(node) {
        return removeClass(node, HILITE_CLASS);
    }

    /**
     * Highlight find&replace matches in given node
     *
     * @param {Node} node
     */
    function renderFindreplace(node) {
        var tokens = getFindReplaceTokens(node);
        hilite(node, tokens, FINDREPLACE_CLASS);
        if (self.settings.findreplace.diff) {
            self.selectNext();
        }
    }

    /**
     * Function for sorting array of strings from longest to shortest
     *
     * @param {string} a
     * @param {string} b
     * @return {number}
     */
    function reverseLengthSort(a, b) {
        return b.length - a.length;
    }

    /**
     * Find all matches for current find&replace needle in given node
     *
     * Each match is {word: {string}, offset: {number}} in given node,
     * we can't return nodes here because those will change when we start
     * highlighting and offsets wouldn't match
     *
     * @param {Node} node
     * @return {Array} list of matches
     */
    function getFindReplaceTokens(node) {
        var tokens = [];
        var diff = self.settings.findreplace.diff || {};
        var pattern = Object.keys(diff).sort(reverseLengthSort).map(escapeRegExp).join('|');
        if (!pattern) {
            return tokens;
        }

        var flags = self.settings.findreplace.caseSensitive ? 'm' : 'im';
        var re = new RegExp(pattern, flags);
        var nodeOffset = 0;
        var text, match, offset;

        var tree = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
        while (tree.nextNode()) {
            text = tree.currentNode.textContent;
            while ((match = text.match(re)) != null) {
                tokens.push({
                    word: match[0],
                    index: nodeOffset + match.index,
                    title: diff[match[0]] || ''
                });

                offset = match.index + match[0].length;
                text = text.substr(offset);
                nodeOffset += offset;
            }

            nodeOffset += text.length;
        }

        return tokens;
    }

    /**
     * Highlight spellcheck errors in given node
     *
     * @param {Node} node
     */
    function renderSpellcheck(node, preventStore) {
        spellcheck.errors(node).then(function(tokens) {
            hilite(node, tokens, ERROR_CLASS, preventStore);
        });
    }

    /**
     * Hilite all tokens within node using span with given className
     *
     * This first stores caret position, updates markup, and then restores the caret.
     *
     * @param {Node} node
     * @param {Array} tokens
     * @param {string} className
     * @param {Boolean} preventStore
     */
    function hilite(node, tokens, className, preventStore) {
        if (!tokens.length) {
            self.resetSelection(node);
            return;
        }

        if (!preventStore) {
            self.storeSelection(node);
        }
        var token = tokens.shift();
        hiliteToken(node, token, className);
        $timeout(hilite(node, tokens, className, true), 0, false);
    }

    /**
     * Highlight single `token` via putting it into a span with given class
     *
     * @param {Node} node
     * @param {Object} token
     * @param {string} className
     */
    function hiliteToken(node, token, className) {
        var start = findTextNode(node, token.index);
        var end = findTextNode(node, token.index + token.word.length);

        // correction for linebreaks - first node on a new line is set to
        // linebreak text node which is not even visible in dom, maybe dom bug?
        if (start.node !== end.node) {
            start.node = end.node;
            start.offset = 0;
        }

        var replace = start.node.splitText(start.offset);
        var span = document.createElement('span');
        span.classList.add(className);
        span.classList.add(HILITE_CLASS);
        if (token.sentenceWord) {
            span.classList.add('sdCapitalize');
        }
        if (token.title) {
            span.title = token.title;
        }
        replace.splitText(end.offset - start.offset);
        span.textContent = replace.textContent;
        replace.parentNode.replaceChild(span, replace);
    }

    /**
     * Set next highlighted node active.
     *
     * In case there is no node selected select first one.
     */
    this.selectNext = function() {
        var nodes = document.body.getElementsByClassName(HILITE_CLASS);
        for (var i = 0; i < nodes.length; i++) {
            var node = nodes.item(i);
            if (node.classList.contains(ACTIVE_CLASS)) {
                node.classList.remove(ACTIVE_CLASS);
                nodes.item((i + 1) % nodes.length).classList.add(ACTIVE_CLASS);
                return;
            }
        }

        if (nodes.length) {
            nodes.item(0).classList.add(ACTIVE_CLASS);
        }
    };

    /**
     * Set previous highlighted node active.
     */
    this.selectPrev = function() {
        var nodes = document.body.getElementsByClassName(HILITE_CLASS);
        for (var i = 0; i < nodes.length; i++) {
            var node = nodes.item(i);
            if (node.classList.contains(ACTIVE_CLASS)) {
                node.classList.remove(ACTIVE_CLASS);
                nodes.item(i === 0 ? nodes.length - 1 : i - 1).classList.add(ACTIVE_CLASS);
                return;
            }
        }
    };

    function replaceText(scope, text, className) {
        if (!className) {
            className = ACTIVE_CLASS;
        }
        var nodes = scope.node.getElementsByClassName(className);
        var nodesLength = nodes.length;
        replaceNodes(nodes, text);
        return nodesLength;
    }

    /**
     * Replace active node with given text.
     *
     * @param {string} text
     */
    this.replace = function(text) {
        scopes.forEach(function(scope) {
            replaceText(scope, text);
            self.commitScope(scope);
        });
    };

    /**
     * Returns the cleaned node text
     *
     * @return {string}
     */
    this.getNodeText = function(scope) {
        return clean(scope.node).innerHTML;
    };

    /**
     * Get active node text
     *
     * @return {string}
     */
    this.getActiveText = function() {
        var active;
        scopes.forEach(function(scope) {
            var nodes = scope.node.getElementsByClassName(ACTIVE_CLASS);
            active = nodes.length ? nodes[0] : active;
        });

        return active ? active.textContent : null;
    };

    /**
     * Replace all highlighted nodes with given text.
     *
     * @param {string} text
     */
    this.replaceAll = function(text) {
        scopes.forEach(function(scope) {
            var nodes = scope.node.getElementsByClassName(HILITE_CLASS);
            replaceNodes(nodes, text);
            self.commitScope(scope);
        });
    };

    /**
     * Replace all nodes with text
     *
     * @param {HTMLCollection} nodes
     * @param {string} text
     */
    function replaceNodes(nodes, text) {
        while (nodes.length) {
            var node = nodes.item(0);
            var textNode = document.createTextNode(text);
            node.parentNode.replaceChild(textNode, node);
            textNode.parentNode.normalize();
        }
    }

    /**
     * Store current anchor position within given node
     */
    this.storeSelection = function storeSelection(node) {
        var spans = node.getElementsByClassName('rangySelectionBoundary');
        if (spans.length === 0 || !self.selection) {
            self.selection = window.rangy && (typeof window.rangy.saveSelection === 'function') ?
                window.rangy.saveSelection() : null;
        }
    };

    /**
     * Reset stored anchor position in given node
     */
    this.resetSelection = function resetSelection(node) {
        if (self.selection) {
            window.rangy.restoreSelection(self.selection);
            self.selection = null;
        }

        clearRangy(node);
    };

    /**
     * Remove all rangy stored selections from given node
     *
     * @param {Node} node
     * @return {Node}
     */
    function clearRangy(node) {
        var spans = node.getElementsByClassName('rangySelectionBoundary');
        while (spans.length) {
            var span = spans.item(0);
            var parent = span.parentNode;
            parent.removeChild(span);
            if (parent && parent.normalize) {
                parent.normalize();
            }
        }
        return node;
    }

    /**
     * Update settings
     *
     * @param {Object} settings
     */
    this.setSettings = function(settings) {
        self.settings = angular.extend({}, self.settings, settings);
    };

    /**
     * Test if given elem is a spellcheck error node
     *
     * @param {Node} elem
     * @return {boolean}
     */
    this.isErrorNode = function(elem) {
        return elem.classList.contains(ERROR_CLASS);
    };

    /**
     * Commit changes in all scopes
     */
    this.commit = function() {
        scopes.forEach(self.commitScope);
    };

    /**
     * Replace abbreviations.
     * @param {Scope} scope
     */
    function replaceAbbreviations (scope) {
        if (!scope.node.classList.contains(TYPING_CLASS)) {
            return $q.when({});
        }

        if (scope.node.innerText !== '') {
            return spellcheck.getAbbreviationsDict().then(function(abbreviations) {
                if (_.keys(abbreviations).length) {
                    var pattern = '\\b(' + _.map(_.keys(abbreviations), function(item) {
                            return escapeRegExp(item);
                        }).join('|') + ')(\\*)';
                    var found = scope.node.innerText.match(new RegExp(pattern, 'g'));
                    if (found) {
                        // store old settings
                        var old_settings = angular.extend({}, self.settings);
                        var caretPosition = scope.medium.exportSelection();

                        _.forEach(_.uniq(found), function(val) {
                            var replacementValue = abbreviations[val.replace('*', '')];
                            if (replacementValue) {
                                var diff = {};
                                diff[val] = replacementValue;
                                self.cleanScope(scope);
                                self.setSettings({findreplace: {diff: diff, caseSensitive: true}});
                                renderFindreplace(scope.node);
                                var nodesLength = replaceText(scope, replacementValue, FINDREPLACE_CLASS);
                                if (nodesLength > 0) {
                                    var incrementCaretPosition = (replacementValue.length - val.length) * nodesLength;
                                    caretPosition.start += incrementCaretPosition;
                                    caretPosition.end += incrementCaretPosition;
                                }
                            }
                        });

                        scope.medium.importSelection(caretPosition);
                        // apply old settings
                        self.setSettings({findreplace: (old_settings.findreplace ? old_settings.findreplace : null)});
                    }
                }
            });
        }

        return $q.when({});
    }

    /**
     * Commit changes in given scope to its model
     *
     * @param {Scope} scope
     */
    this.commitScope = function(scope) {
        replaceAbbreviations(scope).then(function() {
            var nodeValue = clean(scope.node).innerHTML;
            if (nodeValue !== scope.model.$viewValue) {
                scope.model.$setViewValue(nodeValue);
                self.storeSelection(scope.node);
                scope.history.add(clean(scope.node), self.selection);
                self.resetSelection(scope.node);
            }
        });
    };

    /**
     * Undo last operation
     *
     * @param {Scope} scope
     */
    this.undo = function(scope) {
        if (scope.history.getIndex() > -1) {
            scope.history.selectPrev();
            useHistory(scope);
        }
    };

    /**
     * Redo previous operation
     *
     * @param {Scope} scope
     */
    this.redo = function(scope) {
        var oldIndex = scope.history.getIndex();
        scope.history.selectNext();
        if (oldIndex !== scope.history.getIndex()) {
            useHistory(scope);
        }
    };

    /**
     * Gives count of spelling errors.
     *
     */
    this.countErrors = function() {
        var spelling_errors = [];
        var promises = [];

        _.each(scopes, function(scope) {
            promises.push(spellcheck.errors(scope.node).then(
                function(result) {
                    if (result.length) {
                        spelling_errors = spelling_errors.concat(result);
                    }
                }
            ));
        });

        return $q.all(promises).then(function() {
            return spelling_errors.length;
        });
    };

    /**
     * Use value from history and set it as node/model value.
     *
     * @param {Scope} scope
     */
    function useHistory(scope) {
        var val = scope.history.get() || '';
        var checkVal = val.innerHTML ? clearRangy(angular.copy(val)).innerHTML : val;
        if (clean(scope.node).innerHTML !== checkVal) {
            scope.node.innerHTML = val.innerHTML ? val.innerHTML : val;
            clearRangy(scope.node);
            scope.model.$setViewValue(val.innerHTML ? val.innerHTML : val);
            self.selection = scope.history.getSelection();
        } else {
            self.renderScope(scope);
            scope.node.classList.remove(TYPING_CLASS);
        }
    }
}

angular.module('superdesk.editor', ['superdesk.editor.spellcheck'])

    .service('editor', EditorService)

    .directive('sdTextEditor', ['editor', 'spellcheck', '$timeout', 'config', 'keyboardManager', 'Keys',
    function (editor, spellcheck, $timeout, config, keyboardManager, Keys) {

        var disableToolbar = config.editor.disableEditorToolbar || false;

        var editorConfig = {
            buttons: ['bold', 'italic', 'underline', 'quote', 'anchor'],
            anchorInputPlaceholder: gettext('Paste or type a full link'),
            disablePlaceholders: true,
            spellcheck: false,
            disableToolbar: disableToolbar
        };

        return {
            scope: {type: '=', config: '=', language: '='},
            require: 'ngModel',
            templateUrl: 'scripts/superdesk/editor/views/editor.html',
            link: function(scope, elem, attrs, ngModel) {
                scope.model = ngModel;

                var editorElem;
                var updateTimeout;
                var renderTimeout;

                ngModel.$viewChangeListeners.push(changeListener);

                scope.$watch('model.$viewValue', function(newValue, oldValue) {
                    if (newValue !== editor.getNodeText(scope)) {
                        ngModel.$render(true);
                    }
                }, true);

                var ctrlOperations = {};
                ctrlOperations[editor.KEY_CODES.Z] = doUndo;
                ctrlOperations[editor.KEY_CODES.Y] = doRedo;

                scope.$on('spellcheck:run', render);

                ngModel.$render = function (force) {
                    if (!scope.history || scope.history.getIndex() === -1 || force) {
                        editorElem = elem.find('.editor-type-html');
                        editorElem.empty();
                        editorElem.html(ngModel.$viewValue || '');
                    }

                    if (!scope.rendered) {
                        var editorOptions = angular.extend({}, editorConfig, scope.config || {});

                        spellcheck.setLanguage(scope.language);

                        scope.node = editorElem[0];
                        scope.model = ngModel;

                        scope.medium = new window.MediumEditor(scope.node, editorOptions);

                        editorElem.on('keydown', function(event) {

                            if (_.includes(Keys, event.keyCode)) {
                                event.stopPropagation();
                            }

                            if (event.ctrlKey && ctrlOperations[event.keyCode]) {
                                event.preventDefault();
                            }

                            if (editor.shouldIgnore(event)) {
                                return;
                            }

                            cancelTimeout();
                        });

                        editorElem.on('keyup', function(event) {
                            if (editor.shouldIgnore(event)) {
                                return;
                            }

                            cancelTimeout();

                            if (event.ctrlKey && ctrlOperations[event.keyCode]) {
                                ctrlOperations[event.keyCode]();
                                return;
                            }

                            updateTimeout = $timeout(updateModel, 800, false);
                        });

                        editorElem.on('blur', function(event) {
                            $timeout.cancel(updateTimeout);
                            scope.node.classList.remove(TYPING_CLASS);
                            updateModel();
                        });

                        editorElem.on('contextmenu', function(event) {
                            if (editor.isErrorNode(event.target)) {
                                event.preventDefault();
                                var menu = elem[0].getElementsByClassName('dropdown-menu')[0],
                                    toggle = elem[0].getElementsByClassName('dropdown-toggle')[0];
                                if (elem.find('.dropdown.open').length) {
                                    click(toggle);
                                }

                                scope.suggestions = null;
                                spellcheck.suggest(event.target.textContent).then(function(suggestions) {
                                    // capitalize first letter and include it as a suggestion
                                    if (_.includes(event.target.classList, 'sdCapitalize')) {
                                        suggestions.push(event.target.textContent[0].toUpperCase() + event.target.textContent.slice(1));
                                    }
                                    scope.suggestions = _.uniq(suggestions);
                                    scope.replaceTarget = event.target;
                                    $timeout(function() {
                                        menu.style.left = (event.target.offsetLeft) + 'px';
                                        menu.style.top = (event.target.offsetTop + event.target.offsetHeight) + 'px';
                                        menu.style.position = 'absolute';
                                        click(toggle);
                                    }, 0, false);
                                });

                                return false;
                            }
                        });

                        scope.$on('$destroy', function() {
                            editorElem.off();
                            spellcheck.setLanguage(null);
                        });

                        editor.registerScope(scope);
                        scope.cursor = {};
                        render(null, null, true);
                        scope.rendered = true;
                    }
                };

                function cancelTimeout() {
                    $timeout.cancel(updateTimeout);
                    scope.node.classList.add(TYPING_CLASS);
                }

                function render($event, event, preventStore) {
                    editor.renderScope(scope, $event, preventStore);
                    scope.node.classList.remove(TYPING_CLASS);
                    if (event) {
                        event.preventDefault();
                    }
                }

                scope.replace = function(text) {
                    scope.replaceTarget.parentNode.replaceChild(document.createTextNode(text), scope.replaceTarget);
                    editor.commitScope(scope);
                };

                scope.addWordToDictionary = function() {
                    var word = scope.replaceTarget.textContent;
                    spellcheck.addWordToUserDictionary(word);
                    editor.render();
                };

                function doUndo() {
                    editor.undo(scope);
                }

                function doRedo() {
                    editor.redo(scope);
                }

                function updateModel() {
                    if (scope.node.innerHTML.trim() === '<br>' ||
                            scope.node.innerHTML.trim() === '<p><br></p>') {
                        scope.node.innerHTML = '';
                    }
                    editor.commitScope(scope);
                }

                function changeListener() {
                    $timeout.cancel(renderTimeout);
                    renderTimeout = $timeout(render, 50, false);
                }
            }
        };
    }])
    .run(['keyboardManager', 'gettext', function(keyboardManager, gettext) {
        keyboardManager.register('Authoring', 'ctrl + shift + d', gettext('Runs spellchecker'));
    }]);
