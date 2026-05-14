import { Scope } from "./auth.js";
import { ContainerStatus, ReservationStatus } from "./types.js";
import { SERVICE_VERSION } from "./version.js";

const isoDateTimeExample = "2026-05-14T12:00:00.000Z";

export function getOpenApiDocument(): Record<string, unknown> {
  return {
    openapi: "3.1.0",
    info: {
      title: "Equipments Service API",
      version: SERVICE_VERSION,
      description:
        "Machine-readable API documentation for the Equipments service. `GET /health`, `GET /openapi.json`, and the playground are public. All other documented routes require a bearer token.",
      contact: {
        name: "Equipments Service"
      }
    },
    servers: [{ url: "/" }],
    tags: [
      { name: "Service", description: "Service metadata and operational health." },
      { name: "Equipment Types", description: "Employee-managed container equipment catalogue." },
      { name: "Containers", description: "Physical container inventory and lifecycle transitions." },
      { name: "Availability", description: "Availability counts by equipment type and depot." },
      { name: "Reservations", description: "Atomic reservation and release flows." },
      { name: "Events", description: "Operational events consumed by the service." }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description:
            `Signed JWT bearer token. Read routes require the ${Scope.READ} scope. State-changing routes require the ${Scope.MODIFY} scope.`
        }
      },
      responses: {
        ErrorResponse: {
          description: "Domain or authentication error response.",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
              examples: {
                validation: {
                  summary: "Validation failure",
                  value: { error: "containerNumber is required" }
                },
                unauthorized: {
                  summary: "Missing bearer token",
                  value: { error: "missing bearer token" }
                },
                conflict: {
                  summary: "Conflict",
                  value: { error: "booking BKG-2026-00042 already has a reservation" }
                }
              }
            }
          }
        }
      },
      schemas: {
        ErrorResponse: {
          type: "object",
          additionalProperties: false,
          required: ["error"],
          properties: {
            error: { type: "string" }
          }
        },
        HealthResponse: {
          type: "object",
          additionalProperties: false,
          required: ["status", "version"],
          properties: {
            status: { type: "string", const: "ok" },
            version: { type: "string", example: SERVICE_VERSION }
          }
        },
        EquipmentType: {
          type: "object",
          additionalProperties: false,
          required: ["code", "description", "nominalLength", "maxPayloadKg", "createdByUserId", "lastModifiedByUserId", "createdAt", "updatedAt"],
          properties: {
            code: { type: "string", example: "40HC" },
            description: { type: "string", example: "40-foot High Cube" },
            nominalLength: { type: "string", example: "40'" },
            maxPayloadKg: { type: "number", example: 26460 },
            createdByUserId: { type: ["string", "null"], example: "usr_ops_01" },
            lastModifiedByUserId: { type: ["string", "null"], example: "usr_ops_01" },
            createdAt: { type: "string", format: "date-time", example: isoDateTimeExample },
            updatedAt: { type: "string", format: "date-time", example: isoDateTimeExample }
          }
        },
        EquipmentTypeListResponse: {
          type: "object",
          additionalProperties: false,
          required: ["equipmentTypes"],
          properties: {
            equipmentTypes: {
              type: "array",
              items: { $ref: "#/components/schemas/EquipmentType" }
            }
          }
        },
        CreateEquipmentTypeRequest: {
          type: "object",
          additionalProperties: false,
          required: ["code", "description", "nominalLength", "maxPayloadKg"],
          properties: {
            code: { type: "string", example: "45HC" },
            description: { type: "string", example: "45-foot High Cube" },
            nominalLength: { type: "string", example: "45'" },
            maxPayloadKg: { type: "number", example: 29500 }
          }
        },
        UpdateEquipmentTypeRequest: {
          type: "object",
          additionalProperties: false,
          properties: {
            description: { type: "string", example: "45-foot High Cube Updated" },
            nominalLength: { type: "string", example: "45'" },
            maxPayloadKg: { type: "number", example: 29600 }
          }
        },
        ContainerUnit: {
          type: "object",
          additionalProperties: false,
          required: [
            "id",
            "containerNumber",
            "equipmentType",
            "status",
            "currentDepot",
            "bookingReference",
            "createdByUserId",
            "lastModifiedByUserId",
            "lastMovedAt",
            "createdAt",
            "updatedAt"
          ],
          properties: {
            id: { type: "string", example: "6e6b55ce-5f7c-4d3a-ae3d-000000000001" },
            containerNumber: { type: "string", example: "CONU1234567" },
            equipmentType: { type: "string", example: "20FT" },
            status: { type: "string", enum: Object.values(ContainerStatus), example: ContainerStatus.AVAILABLE },
            currentDepot: { type: "string", example: "CNSHA-01" },
            bookingReference: { type: ["string", "null"], example: "BKG-2026-00042" },
            createdByUserId: { type: ["string", "null"], example: "usr_ops_01" },
            lastModifiedByUserId: { type: ["string", "null"], example: "usr_ops_01" },
            lastMovedAt: { type: "string", format: "date-time", example: isoDateTimeExample },
            createdAt: { type: "string", format: "date-time", example: isoDateTimeExample },
            updatedAt: { type: "string", format: "date-time", example: isoDateTimeExample }
          }
        },
        ContainerListResponse: {
          type: "object",
          additionalProperties: false,
          required: ["containers"],
          properties: {
            containers: {
              type: "array",
              items: { $ref: "#/components/schemas/ContainerUnit" }
            }
          }
        },
        RegisterContainerRequest: {
          type: "object",
          additionalProperties: false,
          required: ["containerNumber", "equipmentType", "currentDepot"],
          properties: {
            containerNumber: { type: "string", example: "CONU1234567" },
            equipmentType: { type: "string", example: "20FT" },
            currentDepot: { type: "string", example: "CNSHA-01" }
          }
        },
        OverrideContainerStatusRequest: {
          type: "object",
          additionalProperties: false,
          required: ["status"],
          properties: {
            status: { type: "string", enum: Object.values(ContainerStatus), example: ContainerStatus.IN_TRANSIT }
          }
        },
        AvailabilityItem: {
          type: "object",
          additionalProperties: false,
          required: ["equipmentType", "availableCount", "depotCode"],
          properties: {
            equipmentType: { type: "string", example: "20FT" },
            availableCount: { type: "number", example: 3 },
            depotCode: { type: "string", example: "CNSHA-01" }
          }
        },
        AvailabilityResponse: {
          type: "object",
          additionalProperties: false,
          required: ["availability"],
          properties: {
            availability: {
              type: "array",
              items: { $ref: "#/components/schemas/AvailabilityItem" }
            }
          }
        },
        ReservationItemRequest: {
          type: "object",
          additionalProperties: false,
          required: ["type", "quantity"],
          properties: {
            type: { type: "string", example: "20FT" },
            quantity: { type: "integer", minimum: 1, example: 2 }
          }
        },
        CreateReservationRequest: {
          type: "object",
          additionalProperties: false,
          required: ["bookingReference", "originDepot", "equipment"],
          properties: {
            bookingReference: { type: "string", example: "BKG-2026-00042" },
            originDepot: { type: "string", example: "CNSHA-01" },
            equipment: {
              type: "array",
              minItems: 1,
              items: { $ref: "#/components/schemas/ReservationItemRequest" }
            }
          }
        },
        AssignedContainer: {
          type: "object",
          additionalProperties: false,
          required: ["containerId", "type"],
          properties: {
            containerId: { type: "string", example: "6e6b55ce-5f7c-4d3a-ae3d-000000000001" },
            type: { type: "string", example: "20FT" }
          }
        },
        ReservationResponse: {
          type: "object",
          additionalProperties: false,
          required: [
            "reservationId",
            "bookingReference",
            "status",
            "createdByUserId",
            "lastModifiedByUserId",
            "createdAt",
            "updatedAt"
          ],
          properties: {
            reservationId: { type: "string", example: "d8f64c1f-338b-4a0c-8c00-000000000001" },
            bookingReference: { type: "string", example: "BKG-2026-00042" },
            assignedContainers: {
              type: "array",
              items: { $ref: "#/components/schemas/AssignedContainer" }
            },
            status: { type: "string", enum: Object.values(ReservationStatus), example: ReservationStatus.ACTIVE },
            createdByUserId: { type: ["string", "null"], example: "usr_booking_service" },
            lastModifiedByUserId: { type: ["string", "null"], example: "usr_booking_service" },
            createdAt: { type: "string", format: "date-time", example: isoDateTimeExample },
            updatedAt: { type: "string", format: "date-time", example: isoDateTimeExample }
          }
        },
        EventRequest: {
          type: "object",
          additionalProperties: false,
          required: ["eventType", "payload"],
          properties: {
            eventType: {
              type: "string",
              enum: ["booking.cancelled", "booking.completed"],
              example: "booking.cancelled"
            },
            payload: {
              type: "object",
              additionalProperties: false,
              required: ["bookingReference"],
              properties: {
                bookingReference: { type: "string", example: "BKG-2026-00042" }
              }
            }
          }
        },
        EventResponse: {
          type: "object",
          additionalProperties: false,
          required: ["processed"],
          properties: {
            processed: { type: "boolean", example: true }
          }
        }
      }
    },
    paths: {
      "/health": {
        get: {
          tags: ["Service"],
          summary: "Health check",
          description: "Unauthenticated health endpoint used by deployments and probes.",
          responses: {
            "200": {
              description: "Service is healthy.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/HealthResponse" },
                  example: { status: "ok", version: SERVICE_VERSION }
                }
              }
            }
          }
        }
      },
      "/openapi.json": {
        get: {
          tags: ["Service"],
          summary: "OpenAPI document",
          description: "Machine-readable OpenAPI description for the public Equipments service API.",
          responses: {
            "200": {
              description: "OpenAPI document returned as JSON."
            }
          }
        }
      },
      "/equipment-types": {
        get: {
          tags: ["Equipment Types"],
          summary: "List equipment types",
          security: [{ bearerAuth: [] }],
          responses: {
            "200": {
              description: "Current equipment catalogue.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/EquipmentTypeListResponse" }
                }
              }
            },
            "401": { $ref: "#/components/responses/ErrorResponse" },
            "403": { $ref: "#/components/responses/ErrorResponse" }
          }
        },
        post: {
          tags: ["Equipment Types"],
          summary: "Create equipment type",
          security: [{ bearerAuth: [] }],
          responses: {
            "201": {
              description: "Equipment type created.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/EquipmentType" }
                }
              }
            },
            "400": { $ref: "#/components/responses/ErrorResponse" },
            "401": { $ref: "#/components/responses/ErrorResponse" },
            "403": { $ref: "#/components/responses/ErrorResponse" },
            "409": { $ref: "#/components/responses/ErrorResponse" }
          },
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CreateEquipmentTypeRequest" }
              }
            }
          }
        }
      },
      "/equipment-types/{code}": {
        put: {
          tags: ["Equipment Types"],
          summary: "Update equipment type",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: "code",
              in: "path",
              required: true,
              schema: { type: "string" },
              description: "Equipment type code, case-insensitive.",
              example: "45HC"
            }
          ],
          responses: {
            "200": {
              description: "Equipment type updated.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/EquipmentType" }
                }
              }
            },
            "400": { $ref: "#/components/responses/ErrorResponse" },
            "401": { $ref: "#/components/responses/ErrorResponse" },
            "403": { $ref: "#/components/responses/ErrorResponse" },
            "404": { $ref: "#/components/responses/ErrorResponse" }
          },
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/UpdateEquipmentTypeRequest" }
              }
            }
          }
        }
      },
      "/containers": {
        get: {
          tags: ["Containers"],
          summary: "List containers",
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: "type", in: "query", schema: { type: "string" }, example: "20FT" },
            { name: "status", in: "query", schema: { type: "string", enum: Object.values(ContainerStatus) }, example: "AVAILABLE" },
            { name: "depot", in: "query", schema: { type: "string" }, example: "CNSHA-01" }
          ],
          responses: {
            "200": {
              description: "Filtered container inventory.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ContainerListResponse" }
                }
              }
            },
            "401": { $ref: "#/components/responses/ErrorResponse" },
            "403": { $ref: "#/components/responses/ErrorResponse" }
          }
        },
        post: {
          tags: ["Containers"],
          summary: "Register container",
          security: [{ bearerAuth: [] }],
          responses: {
            "201": {
              description: "Container registered.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ContainerUnit" }
                }
              }
            },
            "400": { $ref: "#/components/responses/ErrorResponse" },
            "401": { $ref: "#/components/responses/ErrorResponse" },
            "403": { $ref: "#/components/responses/ErrorResponse" },
            "409": { $ref: "#/components/responses/ErrorResponse" }
          },
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/RegisterContainerRequest" }
              }
            }
          }
        }
      },
      "/containers/{id}": {
        get: {
          tags: ["Containers"],
          summary: "Get container",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" },
              example: "6e6b55ce-5f7c-4d3a-ae3d-000000000001"
            }
          ],
          responses: {
            "200": {
              description: "Requested container.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ContainerUnit" }
                }
              }
            },
            "401": { $ref: "#/components/responses/ErrorResponse" },
            "403": { $ref: "#/components/responses/ErrorResponse" },
            "404": { $ref: "#/components/responses/ErrorResponse" }
          }
        }
      },
      "/containers/{id}/status": {
        patch: {
          tags: ["Containers"],
          summary: "Override container status",
          description: "Operational override, including the current public path for marking a dispatched container as IN_TRANSIT.",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" },
              example: "6e6b55ce-5f7c-4d3a-ae3d-000000000001"
            }
          ],
          responses: {
            "200": {
              description: "Container status updated.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ContainerUnit" }
                }
              }
            },
            "400": { $ref: "#/components/responses/ErrorResponse" },
            "401": { $ref: "#/components/responses/ErrorResponse" },
            "403": { $ref: "#/components/responses/ErrorResponse" },
            "404": { $ref: "#/components/responses/ErrorResponse" }
          },
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/OverrideContainerStatusRequest" }
              }
            }
          }
        }
      },
      "/availability": {
        get: {
          tags: ["Availability"],
          summary: "Get availability",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: "depotCode",
              in: "query",
              schema: { type: "string" },
              description: "Optional depot filter.",
              example: "CNSHA-01"
            }
          ],
          responses: {
            "200": {
              description: "Availability counts by type and depot.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/AvailabilityResponse" }
                }
              }
            },
            "401": { $ref: "#/components/responses/ErrorResponse" },
            "403": { $ref: "#/components/responses/ErrorResponse" }
          }
        }
      },
      "/reservations": {
        post: {
          tags: ["Reservations"],
          summary: "Create reservation",
          description: "Creates a reservation atomically. The request succeeds only when every requested unit can be allocated.",
          security: [{ bearerAuth: [] }],
          responses: {
            "201": {
              description: "Reservation created.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ReservationResponse" }
                }
              }
            },
            "400": { $ref: "#/components/responses/ErrorResponse" },
            "401": { $ref: "#/components/responses/ErrorResponse" },
            "403": { $ref: "#/components/responses/ErrorResponse" },
            "409": { $ref: "#/components/responses/ErrorResponse" }
          },
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CreateReservationRequest" }
              }
            }
          }
        }
      },
      "/reservations/{bookingReference}": {
        delete: {
          tags: ["Reservations"],
          summary: "Release reservation",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: "bookingReference",
              in: "path",
              required: true,
              schema: { type: "string" },
              example: "BKG-2026-00042"
            }
          ],
          responses: {
            "200": {
              description: "Reservation released.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ReservationResponse" }
                }
              }
            },
            "400": { $ref: "#/components/responses/ErrorResponse" },
            "401": { $ref: "#/components/responses/ErrorResponse" },
            "403": { $ref: "#/components/responses/ErrorResponse" },
            "404": { $ref: "#/components/responses/ErrorResponse" }
          }
        }
      },
      "/containers/{id}/pickup": {
        post: {
          tags: ["Containers"],
          summary: "Record pickup",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" },
              example: "6e6b55ce-5f7c-4d3a-ae3d-000000000001"
            }
          ],
          responses: {
            "200": {
              description: "Container marked as dispatched.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ContainerUnit" }
                }
              }
            },
            "400": { $ref: "#/components/responses/ErrorResponse" },
            "401": { $ref: "#/components/responses/ErrorResponse" },
            "403": { $ref: "#/components/responses/ErrorResponse" },
            "404": { $ref: "#/components/responses/ErrorResponse" }
          }
        }
      },
      "/containers/{id}/return": {
        post: {
          tags: ["Containers"],
          summary: "Record return",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" },
              example: "6e6b55ce-5f7c-4d3a-ae3d-000000000001"
            }
          ],
          responses: {
            "200": {
              description: "Container returned to depot and made available again.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ContainerUnit" }
                }
              }
            },
            "400": { $ref: "#/components/responses/ErrorResponse" },
            "401": { $ref: "#/components/responses/ErrorResponse" },
            "403": { $ref: "#/components/responses/ErrorResponse" },
            "404": { $ref: "#/components/responses/ErrorResponse" }
          }
        }
      },
      "/events": {
        post: {
          tags: ["Events"],
          summary: "Consume event",
          description: "Consumes supported booking lifecycle events and applies the matching store transition.",
          security: [{ bearerAuth: [] }],
          responses: {
            "200": {
              description: "Event processed.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/EventResponse" }
                }
              }
            },
            "400": { $ref: "#/components/responses/ErrorResponse" },
            "401": { $ref: "#/components/responses/ErrorResponse" },
            "403": { $ref: "#/components/responses/ErrorResponse" }
          },
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/EventRequest" }
              }
            }
          }
        }
      }
    }
  };
}
