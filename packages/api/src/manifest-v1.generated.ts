/**
 * Generated from schema/blue.plugin.v1.schema.json.
 *
 * @module @dsh-blue/blue-api/manifest-v1-generated
 */

/** Protocol version stamped into the canonical manifest schema. */
export const BLUE_PLUGIN_PROTOCOL_VERSION = "1.0.0-beta.2"

/** Product-to-protocol mapping stamped into the canonical manifest schema. */
export const BLUE_PRODUCT_PROTOCOL_VERSIONS_SOURCE = {
  "0.1.1-rc.2": "1.0.0-beta.2",
  "0.1.1-rc.3": "1.0.0-beta.2",
  "0.1.2-alpha.1": "1.0.0-beta.2"
} as const

/** Capability names present in the v1 target machine catalog. */
export const BLUE_PLUGIN_CAPABILITIES_V1 = Object.freeze(["commands","status","panes","overlays","notifications.publish","session.read","session.projections.read"] as const)

/** A capability name in the v1 target catalog. */
export type BluePluginCapabilityNameV1 = typeof BLUE_PLUGIN_CAPABILITIES_V1[number]

/** One required or optional capability request. */
export type BluePluginCapabilityRequestV1 =
  | { readonly "name": "commands", readonly "version": string, readonly "resources": { readonly "names": readonly string[] } }
  | { readonly "name": "status", readonly "version": string }
  | { readonly "name": "panes", readonly "version": string, readonly "resources": { readonly "placements": readonly ("header" | "left" | "right" | "bottom")[] } }
  | { readonly "name": "overlays", readonly "version": string }
  | { readonly "name": "notifications.publish", readonly "version": string }
  | { readonly "name": "session.read", readonly "version": string, readonly "resources": { readonly "fields": readonly ("identity" | "cwd" | "status" | "mode" | "model")[] } }
  | { readonly "name": "session.projections.read", readonly "version": string, readonly "resources": { readonly "keys": readonly string[] } }

/** Blue, Harness, and Node compatibility ranges. */
export type BluePluginCompatibilityV1 = { readonly "blue": string, readonly "harness": string, readonly "node": string }

/** The distribution manifest described by the canonical v1 schema. */
export type BluePluginManifestV1 = { readonly "$schema": "https://dsh-blue.dev/schema/blue.plugin.v1.schema.json", readonly "schemaVersion": 1, readonly "id": string, readonly "entry": string, readonly "api": string, readonly "compatibility": BluePluginCompatibilityV1, readonly "capabilities": { readonly "required": readonly BluePluginCapabilityRequestV1[], readonly "optional": readonly BluePluginCapabilityRequestV1[] } }

/** Public type of the canonical schema without expanding every JSON literal. */
export interface BluePluginManifestSchemaV1 extends Readonly<Record<string, unknown>> {
  readonly '$schema': "https://json-schema.org/draft/2020-12/schema"
  readonly '$id': "https://dsh-blue.dev/schema/blue.plugin.v1.schema.json"
}

/** Canonical Draft 2020-12 schema source consumed by the public runtime. */
export const BLUE_PLUGIN_MANIFEST_V1_SCHEMA_SOURCE: BluePluginManifestSchemaV1 = {
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://dsh-blue.dev/schema/blue.plugin.v1.schema.json",
  "title": "Blue Plugin Manifest v1",
  "x-blue-protocol-version": "1.0.0-beta.2",
  "x-blue-product-versions": {
    "0.1.1-rc.2": "1.0.0-beta.2",
    "0.1.1-rc.3": "1.0.0-beta.2",
    "0.1.2-alpha.1": "1.0.0-beta.2"
  },
  "type": "object",
  "additionalProperties": false,
  "required": [
    "$schema",
    "schemaVersion",
    "id",
    "entry",
    "api",
    "compatibility",
    "capabilities"
  ],
  "properties": {
    "$schema": {
      "const": "https://dsh-blue.dev/schema/blue.plugin.v1.schema.json"
    },
    "schemaVersion": {
      "const": 1
    },
    "id": {
      "type": "string",
      "format": "npm-package-name"
    },
    "entry": {
      "type": "string",
      "format": "package-export-subpath"
    },
    "api": {
      "type": "string",
      "format": "semver-range"
    },
    "compatibility": {
      "$ref": "#/$defs/compatibility"
    },
    "capabilities": {
      "$ref": "#/$defs/capabilityGroups"
    }
  },
  "$defs": {
    "compatibility": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "blue",
        "harness",
        "node"
      ],
      "properties": {
        "blue": {
          "type": "string",
          "format": "semver-range"
        },
        "harness": {
          "type": "string",
          "format": "semver-range"
        },
        "node": {
          "type": "string",
          "format": "semver-range"
        }
      }
    },
    "capabilityGroups": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "required",
        "optional"
      ],
      "properties": {
        "required": {
          "type": "array",
          "maxItems": 7,
          "items": {
            "$ref": "#/$defs/capability"
          }
        },
        "optional": {
          "type": "array",
          "maxItems": 7,
          "items": {
            "$ref": "#/$defs/capability"
          }
        }
      }
    },
    "capability": {
      "oneOf": [
        {
          "$ref": "#/$defs/commands"
        },
        {
          "$ref": "#/$defs/status"
        },
        {
          "$ref": "#/$defs/panes"
        },
        {
          "$ref": "#/$defs/overlays"
        },
        {
          "$ref": "#/$defs/notificationsPublish"
        },
        {
          "$ref": "#/$defs/sessionRead"
        },
        {
          "$ref": "#/$defs/sessionProjectionsRead"
        }
      ]
    },
    "commands": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "name",
        "version",
        "resources"
      ],
      "properties": {
        "name": {
          "const": "commands"
        },
        "version": {
          "type": "string",
          "format": "semver-range"
        },
        "resources": {
          "$ref": "#/$defs/commandResources"
        }
      }
    },
    "commandResources": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "names"
      ],
      "properties": {
        "names": {
          "type": "array",
          "minItems": 1,
          "uniqueItems": true,
          "items": {
            "type": "string",
            "pattern": "^[a-z0-9][a-z0-9._-]*$"
          }
        }
      }
    },
    "status": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "name",
        "version"
      ],
      "properties": {
        "name": {
          "const": "status"
        },
        "version": {
          "type": "string",
          "format": "semver-range"
        }
      }
    },
    "panes": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "name",
        "version",
        "resources"
      ],
      "properties": {
        "name": {
          "const": "panes"
        },
        "version": {
          "type": "string",
          "format": "semver-range"
        },
        "resources": {
          "$ref": "#/$defs/paneResources"
        }
      }
    },
    "paneResources": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "placements"
      ],
      "properties": {
        "placements": {
          "type": "array",
          "minItems": 1,
          "uniqueItems": true,
          "items": {
            "enum": [
              "header",
              "left",
              "right",
              "bottom"
            ]
          }
        }
      }
    },
    "overlays": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "name",
        "version"
      ],
      "properties": {
        "name": {
          "const": "overlays"
        },
        "version": {
          "type": "string",
          "format": "semver-range"
        }
      }
    },
    "notificationsPublish": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "name",
        "version"
      ],
      "properties": {
        "name": {
          "const": "notifications.publish"
        },
        "version": {
          "type": "string",
          "format": "semver-range"
        }
      }
    },
    "sessionRead": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "name",
        "version",
        "resources"
      ],
      "properties": {
        "name": {
          "const": "session.read"
        },
        "version": {
          "type": "string",
          "format": "semver-range"
        },
        "resources": {
          "$ref": "#/$defs/sessionReadResources"
        }
      }
    },
    "sessionReadResources": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "fields"
      ],
      "properties": {
        "fields": {
          "type": "array",
          "minItems": 1,
          "uniqueItems": true,
          "items": {
            "enum": [
              "identity",
              "cwd",
              "status",
              "mode",
              "model"
            ]
          }
        }
      }
    },
    "sessionProjectionsRead": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "name",
        "version",
        "resources"
      ],
      "properties": {
        "name": {
          "const": "session.projections.read"
        },
        "version": {
          "type": "string",
          "format": "semver-range"
        },
        "resources": {
          "$ref": "#/$defs/sessionProjectionResources"
        }
      }
    },
    "sessionProjectionResources": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "keys"
      ],
      "properties": {
        "keys": {
          "type": "array",
          "minItems": 1,
          "uniqueItems": true,
          "items": {
            "type": "string",
            "maxLength": 128,
            "pattern": "^[A-Za-z0-9][A-Za-z0-9._:/-]*$"
          }
        }
      }
    }
  }
}
