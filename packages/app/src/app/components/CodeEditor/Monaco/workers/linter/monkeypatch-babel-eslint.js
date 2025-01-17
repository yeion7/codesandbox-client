/* eslint-disable no-underscore-dangle, global-require, no-var, vars-on-top, no-param-reassign, prefer-arrow-callback, no-func-names, no-continue, no-use-before-define, no-plusplus, prefer-spread, prefer-rest-params, no-multi-assign, func-names */

const t = require('babel-types');

export default function monkeypatch(modules, eslintOptions) {
  const escope = require('eslint-scope');
  const Definition = require('eslint-scope/lib/definition').Definition;
  const estraverse = require('estraverse');
  const referencer = require('eslint-scope/lib/referencer');

  // var Definition = modules.Definition;
  // var escope = modules.escope;
  // var estraverse = modules.estraverse;
  // var referencer = modules.referencer;

  Object.assign(estraverse.VisitorKeys, t.VISITOR_KEYS);
  estraverse.VisitorKeys.MethodDefinition.push('decorators');
  estraverse.VisitorKeys.Property.push('decorators');

  var analyze = escope.analyze;
  escope.analyze = function(ast, opts) {
    opts = opts || {};
    opts.ecmaVersion = eslintOptions.ecmaVersion;
    opts.sourceType = eslintOptions.sourceType;
    if (eslintOptions.globalReturn !== undefined) {
      opts.nodejsScope = eslintOptions.globalReturn;
    }

    var results = analyze.call(this, ast, opts);
    return results;
  };

  // if there are decorators, then visit each
  function visitDecorators(node) {
    if (!node.decorators) {
      return;
    }
    for (var i = 0; i < node.decorators.length; i++) {
      if (node.decorators[i].expression) {
        this.visit(node.decorators[i]);
      }
    }
  }

  // iterate through part of t.VISITOR_KEYS
  var flowFlippedAliasKeys = t.FLIPPED_ALIAS_KEYS.Flow.concat([
    'ArrayPattern',
    'ClassDeclaration',
    'ClassExpression',
    'FunctionDeclaration',
    'FunctionExpression',
    'Identifier',
    'ObjectPattern',
    'RestElement',
  ]);
  var visitorKeysMap = Object.keys(t.VISITOR_KEYS).reduce(function(acc, key) {
    var value = t.VISITOR_KEYS[key];
    if (!flowFlippedAliasKeys.includes(value)) {
      acc[key] = value;
    }
    return acc;
  }, {});

  var propertyTypes = {
    // loops
    callProperties: { type: 'loop', values: ['value'] },
    indexers: { type: 'loop', values: ['key', 'value'] },
    properties: { type: 'loop', values: ['argument', 'value'] },
    types: { type: 'loop' },
    params: { type: 'loop' },
    // single property
    argument: { type: 'single' },
    elementType: { type: 'single' },
    qualification: { type: 'single' },
    rest: { type: 'single' },
    returnType: { type: 'single' },
    // others
    typeAnnotation: { type: 'typeAnnotation' },
    typeParameters: { type: 'typeParameters' },
    id: { type: 'id' },
  };

  function visitTypeAnnotation(node) {
    // get property to check (params, id, etc...)
    var visitorValues = visitorKeysMap[node.type];
    if (!visitorValues) {
      return;
    }

    // can have multiple properties
    for (var i = 0; i < visitorValues.length; i++) {
      var visitorValue = visitorValues[i];
      var propertyType = propertyTypes[visitorValue];
      var nodeProperty = node[visitorValue];
      // check if property or type is defined
      if (propertyType == null || nodeProperty == null) {
        continue;
      }
      if (propertyType.type === 'loop') {
        for (var j = 0; j < nodeProperty.length; j++) {
          if (Array.isArray(propertyType.values)) {
            for (var k = 0; k < propertyType.values.length; k++) {
              var loopPropertyNode = nodeProperty[j][propertyType.values[k]];
              if (loopPropertyNode) {
                checkIdentifierOrVisit.call(this, loopPropertyNode);
              }
            }
          } else {
            checkIdentifierOrVisit.call(this, nodeProperty[j]);
          }
        }
      } else if (propertyType.type === 'single') {
        checkIdentifierOrVisit.call(this, nodeProperty);
      } else if (propertyType.type === 'typeAnnotation') {
        visitTypeAnnotation.call(this, node.typeAnnotation);
      } else if (propertyType.type === 'typeParameters') {
        for (var l = 0; l < node.typeParameters.params.length; l++) {
          checkIdentifierOrVisit.call(this, node.typeParameters.params[l]);
        }
      } else if (propertyType.type === 'id') {
        if (node.id.type === 'Identifier') {
          checkIdentifierOrVisit.call(this, node.id);
        } else {
          visitTypeAnnotation.call(this, node.id);
        }
      }
    }
  }

  function checkIdentifierOrVisit(node) {
    if (node.typeAnnotation) {
      visitTypeAnnotation.call(this, node.typeAnnotation);
    } else if (node.type === 'Identifier') {
      this.visit(node);
    } else {
      visitTypeAnnotation.call(this, node);
    }
  }

  function nestTypeParamScope(manager, node) {
    var parentScope = manager.__currentScope;
    var scope = new escope.Scope(
      manager,
      'type-parameters',
      parentScope,
      node,
      false
    );
    manager.__nestScope(scope);
    for (var j = 0; j < node.typeParameters.params.length; j++) {
      var name = node.typeParameters.params[j];
      scope.__define(name, new Definition('TypeParameter', name, name));
      if (name.typeAnnotation) {
        checkIdentifierOrVisit.call(this, name);
      }
    }
    scope.__define = function() {
      return parentScope.__define.apply(parentScope, arguments);
    };
    return scope;
  }

  // visit decorators that are in: ClassDeclaration / ClassExpression
  var visitClass = referencer.prototype.visitClass;
  referencer.prototype.visitClass = function(node) {
    visitDecorators.call(this, node);
    var typeParamScope;
    if (node.typeParameters) {
      typeParamScope = nestTypeParamScope.call(this, this.scopeManager, node);
    }
    // visit flow type: ClassImplements
    if (node.implements) {
      for (var i = 0; i < node.implements.length; i++) {
        checkIdentifierOrVisit.call(this, node.implements[i]);
      }
    }
    if (node.superTypeParameters) {
      for (var k = 0; k < node.superTypeParameters.params.length; k++) {
        checkIdentifierOrVisit.call(this, node.superTypeParameters.params[k]);
      }
    }
    visitClass.call(this, node);
    if (typeParamScope) {
      this.close(node);
    }
  };

  // visit decorators that are in: Property / MethodDefinition
  var visitProperty = referencer.prototype.visitProperty;
  referencer.prototype.visitProperty = function(node) {
    if (node.value && node.value.type === 'TypeCastExpression') {
      visitTypeAnnotation.call(this, node.value);
    }
    visitDecorators.call(this, node);
    visitProperty.call(this, node);
  };

  function visitClassProperty(node) {
    if (node.typeAnnotation) {
      visitTypeAnnotation.call(this, node.typeAnnotation);
    }
    this.visitProperty(node);
  }

  // visit ClassProperty as a Property.
  referencer.prototype.ClassProperty = visitClassProperty;

  // visit ClassPrivateProperty as a Property.
  referencer.prototype.ClassPrivateProperty = visitClassProperty;

  // visit flow type in FunctionDeclaration, FunctionExpression, ArrowFunctionExpression
  var visitFunction = referencer.prototype.visitFunction;
  referencer.prototype.visitFunction = function(node) {
    var typeParamScope;
    if (node.typeParameters) {
      typeParamScope = nestTypeParamScope.call(this, this.scopeManager, node);
    }
    if (node.returnType) {
      checkIdentifierOrVisit.call(this, node.returnType);
    }
    // only visit if function parameters have types
    if (node.params) {
      for (var i = 0; i < node.params.length; i++) {
        var param = node.params[i];
        if (param.typeAnnotation) {
          checkIdentifierOrVisit.call(this, param);
        } else if (t.isAssignmentPattern(param)) {
          if (param.left.typeAnnotation) {
            checkIdentifierOrVisit.call(this, param.left);
          }
        }
      }
    }
    // set ArrayPattern/ObjectPattern visitor keys back to their original. otherwise
    // escope will traverse into them and include the identifiers within as declarations
    estraverse.VisitorKeys.ObjectPattern = ['properties'];
    estraverse.VisitorKeys.ArrayPattern = ['elements'];
    visitFunction.call(this, node);
    // set them back to normal...
    estraverse.VisitorKeys.ObjectPattern = t.VISITOR_KEYS.ObjectPattern;
    estraverse.VisitorKeys.ArrayPattern = t.VISITOR_KEYS.ArrayPattern;
    if (typeParamScope) {
      this.close(node);
    }
  };

  // visit flow type in VariableDeclaration
  var variableDeclaration = referencer.prototype.VariableDeclaration;
  referencer.prototype.VariableDeclaration = function(node) {
    if (node.declarations) {
      for (var i = 0; i < node.declarations.length; i++) {
        var id = node.declarations[i].id;
        var typeAnnotation = id.typeAnnotation;
        if (typeAnnotation) {
          checkIdentifierOrVisit.call(this, typeAnnotation);
        }
      }
    }
    variableDeclaration.call(this, node);
  };

  function createScopeVariable(node, name) {
    this.currentScope().variableScope.__define(
      name,
      new Definition('Variable', name, node, null, null, null)
    );
  }

  referencer.prototype.InterfaceDeclaration = function(node) {
    createScopeVariable.call(this, node, node.id);
    var typeParamScope;
    if (node.typeParameters) {
      typeParamScope = nestTypeParamScope.call(this, this.scopeManager, node);
    }
    // TODO: Handle mixins
    for (var i = 0; i < node.extends.length; i++) {
      visitTypeAnnotation.call(this, node.extends[i]);
    }
    visitTypeAnnotation.call(this, node.body);
    if (typeParamScope) {
      this.close(node);
    }
  };

  referencer.prototype.TypeAlias = function(node) {
    createScopeVariable.call(this, node, node.id);
    var typeParamScope;
    if (node.typeParameters) {
      typeParamScope = nestTypeParamScope.call(this, this.scopeManager, node);
    }
    if (node.right) {
      visitTypeAnnotation.call(this, node.right);
    }
    if (typeParamScope) {
      this.close(node);
    }
  };

  referencer.prototype.DeclareModule = referencer.prototype.DeclareFunction = referencer.prototype.DeclareVariable = referencer.prototype.DeclareClass = function(
    node
  ) {
    if (node.id) {
      createScopeVariable.call(this, node, node.id);
    }

    var typeParamScope;
    if (node.typeParameters) {
      typeParamScope = nestTypeParamScope.call(this, this.scopeManager, node);
    }
    if (typeParamScope) {
      this.close(node);
    }
  };
}
