package com.veeva.vault.custom;

import com.veeva.vault.sdk.api.core.RequestContext;
import com.veeva.vault.sdk.api.core.ServiceLocator;
import com.veeva.vault.sdk.api.core.ValueType;
import com.veeva.vault.sdk.api.core.VaultCollections;
import com.veeva.vault.sdk.api.data.Record;
import com.veeva.vault.sdk.api.data.RecordBatchSaveRequest;
import com.veeva.vault.sdk.api.data.RecordService;
import com.veeva.vault.sdk.api.executeas.ExecuteAs;
import com.veeva.vault.sdk.api.executeas.ExecuteAsUser;
import com.veeva.vault.sdk.api.json.JsonArray;
import com.veeva.vault.sdk.api.json.JsonArrayBuilder;
import com.veeva.vault.sdk.api.json.JsonObject;
import com.veeva.vault.sdk.api.json.JsonObjectBuilder;
import com.veeva.vault.sdk.api.json.JsonService;
import com.veeva.vault.sdk.api.json.JsonValueType;
import com.veeva.vault.sdk.api.page.PageController;
import com.veeva.vault.sdk.api.page.PageControllerInfo;
import com.veeva.vault.sdk.api.page.PageEventContext;
import com.veeva.vault.sdk.api.page.PageEventResponse;
import com.veeva.vault.sdk.api.page.PageLoadContext;
import com.veeva.vault.sdk.api.page.PageLoadResponse;
import com.veeva.vault.sdk.api.query.QueryExecutionRequest;
import com.veeva.vault.sdk.api.query.QueryExecutionResponse;
import com.veeva.vault.sdk.api.query.QueryExecutionResult;
import com.veeva.vault.sdk.api.query.QueryResponse;
import com.veeva.vault.sdk.api.query.QueryResult;
import com.veeva.vault.sdk.api.query.QueryService;

import java.util.List;
import java.util.Set;

/**
 * RetroVault PageController
 *
 * Handles all data access for the RetroVault Custom Page:
 *  - onLoad() returns the currently authenticated user's ID
 *  - onEvent() handles four event types: query, create, update, delete
 *
 * A whitelist restricts the objects the client can interact with.
 */
@ExecuteAs(ExecuteAsUser.REQUEST_OWNER)
@PageControllerInfo
public class RetroVaultPageController implements PageController {

    private static final Set<String> ALLOWED_OBJECTS = VaultCollections.asSet(
            "team__c",
            "retro_board__c",
            "feedback_item__c",
            "action_item__c",
            "vote__c",
            "user__sys"
    );

    /* =========================================================
     * onLoad - return current user ID
     * ========================================================= */

    @Override
    public PageLoadResponse onLoad(PageLoadContext context) {
        JsonService jsonService = ServiceLocator.locate(JsonService.class);

        JsonObject data = jsonService.newJsonObjectBuilder()
                .setValue("userId", RequestContext.get().getInitiatingUserId())
                .build();

        return context.newLoadResponseBuilder()
                .withData(data)
                .build();
    }

    /* =========================================================
     * onEvent - dispatch query/create/update/delete events
     * ========================================================= */

    @Override
    public PageEventResponse onEvent(PageEventContext context) {
        JsonService jsonService = ServiceLocator.locate(JsonService.class);
        String eventName = context.getEventName();
        JsonObject eventData = context.getData(JsonObject.class);

        try {
            JsonObject result;
            switch (eventName) {
                case "query":
                    result = handleQuery(eventData, jsonService);
                    break;
                case "create":
                    result = handleCreate(eventData, jsonService);
                    break;
                case "update":
                    result = handleUpdate(eventData, jsonService);
                    break;
                case "delete":
                    result = handleDelete(eventData, jsonService);
                    break;
                default:
                    return errorResponse(context, jsonService, "Unknown event: " + eventName);
            }
            return context.newEventResponseBuilder().withData(result).build();
        } catch (Exception e) {
            return errorResponse(context, jsonService, e.getMessage());
        }
    }

    /* =========================================================
     * Event Handlers
     * ========================================================= */

    /**
     * Handle "query" event
     * Payload: { vql: "SELECT id, name__v FROM team__c" }
     * Returns: { success: true, records: [ {...}, {...} ] }
     */
    private JsonObject handleQuery(JsonObject data, JsonService jsonService) {
        String vql = data.getValue("vql", JsonValueType.STRING);
        if (vql == null || vql.isEmpty()) {
            throw new IllegalArgumentException("Missing required parameter: vql");
        }

        // Basic whitelist check - the FROM clause must reference an allowed object
        assertVqlWhitelisted(vql);

        QueryService queryService = ServiceLocator.locate(QueryService.class);
        QueryExecutionRequest request = queryService.newQueryExecutionRequestBuilder()
                .withQueryString(vql)
                .build();

        JsonArrayBuilder records = jsonService.newJsonArrayBuilder();

        queryService.query(request)
                .onSuccess(queryExecutionResponse -> {
                    queryExecutionResponse.streamResults().forEach(row -> {
                        JsonObjectBuilder obj = jsonService.newJsonObjectBuilder();
                        row.getFieldNames().forEach(field -> {
                            Object value = row.getValue(field, ValueType.STRING);
                            if (value == null) {
                                // Try other types
                                try {
                                    Object num = row.getValue(field, ValueType.NUMBER);
                                    if (num != null) {
                                        obj.setValue(field, ((Number) num).doubleValue());
                                        return;
                                    }
                                } catch (Exception ignored) { }
                                try {
                                    Object bool = row.getValue(field, ValueType.BOOLEAN);
                                    if (bool != null) {
                                        obj.setValue(field, (Boolean) bool);
                                        return;
                                    }
                                } catch (Exception ignored) { }
                                obj.setValue(field, (String) null);
                            } else {
                                obj.setValue(field, value.toString());
                            }
                        });
                        records.add(obj.build());
                    });
                })
                .onError(queryOperationError -> {
                    throw new RuntimeException("Query failed: " + queryOperationError.getMessage());
                })
                .execute();

        return jsonService.newJsonObjectBuilder()
                .setValue("success", true)
                .setValue("records", records.build())
                .build();
    }

    /**
     * Handle "create" event
     * Payload: { object: "feedback_item__c", fields: {...} }
     * Returns: { success: true, id: "newRecordId" }
     */
    private JsonObject handleCreate(JsonObject data, JsonService jsonService) {
        String objectName = data.getValue("object", JsonValueType.STRING);
        JsonObject fields = data.getValue("fields", JsonValueType.OBJECT);
        assertAllowed(objectName);

        RecordService recordService = ServiceLocator.locate(RecordService.class);
        Record record = recordService.newRecord(objectName);
        applyFields(record, fields);

        List<Record> records = VaultCollections.asList(record);
        final String[] createdId = { null };
        final String[] errorMsg = { null };

        recordService.batchSaveRecords(records)
                .onSuccesses(successes -> {
                    successes.forEach(s -> createdId[0] = s.getRecord().getValue("id", ValueType.STRING));
                })
                .onErrors(errors -> {
                    errors.forEach(e -> errorMsg[0] = e.getError().getMessage());
                })
                .execute();

        if (errorMsg[0] != null) {
            throw new RuntimeException("Create failed: " + errorMsg[0]);
        }

        return jsonService.newJsonObjectBuilder()
                .setValue("success", true)
                .setValue("id", createdId[0])
                .build();
    }

    /**
     * Handle "update" event
     * Payload: { object: "feedback_item__c", id: "...", fields: {...} }
     * Returns: { success: true, id: "..." }
     */
    private JsonObject handleUpdate(JsonObject data, JsonService jsonService) {
        String objectName = data.getValue("object", JsonValueType.STRING);
        String recordId = data.getValue("id", JsonValueType.STRING);
        JsonObject fields = data.getValue("fields", JsonValueType.OBJECT);
        assertAllowed(objectName);

        if (recordId == null || recordId.isEmpty()) {
            throw new IllegalArgumentException("Missing required parameter: id");
        }

        RecordService recordService = ServiceLocator.locate(RecordService.class);
        Record record = recordService.newRecordWithId(objectName, recordId);
        applyFields(record, fields);

        List<Record> records = VaultCollections.asList(record);
        final String[] errorMsg = { null };

        recordService.batchSaveRecords(records)
                .onErrors(errors -> errors.forEach(e -> errorMsg[0] = e.getError().getMessage()))
                .execute();

        if (errorMsg[0] != null) {
            throw new RuntimeException("Update failed: " + errorMsg[0]);
        }

        return jsonService.newJsonObjectBuilder()
                .setValue("success", true)
                .setValue("id", recordId)
                .build();
    }

    /**
     * Handle "delete" event
     * Payload: { object: "vote__c", id: "..." }
     * Returns: { success: true }
     */
    private JsonObject handleDelete(JsonObject data, JsonService jsonService) {
        String objectName = data.getValue("object", JsonValueType.STRING);
        String recordId = data.getValue("id", JsonValueType.STRING);
        assertAllowed(objectName);

        if (recordId == null || recordId.isEmpty()) {
            throw new IllegalArgumentException("Missing required parameter: id");
        }

        RecordService recordService = ServiceLocator.locate(RecordService.class);
        Record record = recordService.newRecordWithId(objectName, recordId);
        List<Record> records = VaultCollections.asList(record);
        final String[] errorMsg = { null };

        recordService.batchDeleteRecords(records)
                .onErrors(errors -> errors.forEach(e -> errorMsg[0] = e.getError().getMessage()))
                .execute();

        if (errorMsg[0] != null) {
            throw new RuntimeException("Delete failed: " + errorMsg[0]);
        }

        return jsonService.newJsonObjectBuilder()
                .setValue("success", true)
                .build();
    }

    /* =========================================================
     * Helpers
     * ========================================================= */

    private void assertAllowed(String objectName) {
        if (objectName == null || !ALLOWED_OBJECTS.contains(objectName)) {
            throw new IllegalArgumentException("Object not allowed: " + objectName);
        }
    }

    private void assertVqlWhitelisted(String vql) {
        String upper = vql.toUpperCase();
        boolean ok = false;
        for (String obj : ALLOWED_OBJECTS) {
            if (upper.contains(" FROM " + obj.toUpperCase())) {
                ok = true;
                break;
            }
        }
        if (!ok) {
            throw new IllegalArgumentException("Query must target an allowed object");
        }
    }

    /**
     * Apply field values from a JsonObject to a Record.
     * Handles string, number, and boolean types.
     */
    private void applyFields(Record record, JsonObject fields) {
        if (fields == null) return;
        fields.getFieldNames().forEach(fieldName -> {
            JsonValueType type = fields.getValueType(fieldName);
            switch (type) {
                case STRING:
                    record.setValue(fieldName, fields.getValue(fieldName, JsonValueType.STRING));
                    break;
                case NUMBER:
                    Number num = (Number) fields.getValue(fieldName, JsonValueType.NUMBER);
                    if (num != null) {
                        record.setValue(fieldName, num);
                    }
                    break;
                case BOOLEAN:
                    record.setValue(fieldName, fields.getValue(fieldName, JsonValueType.BOOLEAN));
                    break;
                case NULL:
                    record.setValue(fieldName, (String) null);
                    break;
                default:
                    // Ignore complex types (arrays, nested objects)
                    break;
            }
        });
    }

    private PageEventResponse errorResponse(PageEventContext context, JsonService jsonService, String message) {
        JsonObject errorData = jsonService.newJsonObjectBuilder()
                .setValue("success", false)
                .setValue("error", message != null ? message : "Unknown error")
                .build();
        return context.newEventResponseBuilder().withData(errorData).build();
    }
}
