package com.veeva.vault.custom;

import com.veeva.vault.sdk.api.core.RequestContext;
import com.veeva.vault.sdk.api.core.RollbackException;
import com.veeva.vault.sdk.api.core.ServiceLocator;
import com.veeva.vault.sdk.api.core.ValueType;
import com.veeva.vault.sdk.api.core.VaultCollections;
import com.veeva.vault.sdk.api.data.PositionalRecordId;
import com.veeva.vault.sdk.api.data.Record;
import com.veeva.vault.sdk.api.data.RecordService;
import com.veeva.vault.sdk.api.executeas.ExecuteAs;
import com.veeva.vault.sdk.api.executeas.ExecuteAsUser;
import com.veeva.vault.sdk.api.json.JsonArray;
import com.veeva.vault.sdk.api.json.JsonArrayBuilder;
import com.veeva.vault.sdk.api.json.JsonObject;
import com.veeva.vault.sdk.api.json.JsonObjectBuilder;
import com.veeva.vault.sdk.api.json.JsonProperty;
import com.veeva.vault.sdk.api.json.JsonService;
import com.veeva.vault.sdk.api.json.JsonValueType;
import com.veeva.vault.sdk.api.page.PageController;
import com.veeva.vault.sdk.api.page.PageControllerInfo;
import com.veeva.vault.sdk.api.page.PageEventContext;
import com.veeva.vault.sdk.api.page.PageEventResponse;
import com.veeva.vault.sdk.api.page.PageLoadContext;
import com.veeva.vault.sdk.api.page.PageLoadResponse;
import com.veeva.vault.sdk.api.query.QueryExecutionRequest;
import com.veeva.vault.sdk.api.query.QueryService;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.ZonedDateTime;
import java.util.List;
import java.util.Map;

/**
 * RetroVault PageController
 *
 * Handles all data access for the RetroVault Custom Page:
 *  - onLoad() returns the currently authenticated user's ID
 *  - onEvent() handles four event types: query, create, update, delete
 *
 * A whitelist restricts the objects the client can interact with.
 *
 * Vault Java SDK constraints:
 *  - No static field initializers (collections must be built per-call)
 *  - Cannot construct java.lang.* exceptions; throw RollbackException instead
 *  - Cannot catch java.lang.Exception; catch RollbackException specifically
 */
@ExecuteAs(ExecuteAsUser.REQUEST_OWNER)
@PageControllerInfo
public class RetroVaultPageController implements PageController {

    private static final String ERR_BAD_INPUT = "INVALID_INPUT";
    private static final String ERR_NOT_ALLOWED = "OBJECT_NOT_ALLOWED";
    private static final String ERR_OPERATION_FAILED = "OPERATION_FAILED";

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

    @Override
    public PageEventResponse onEvent(PageEventContext context) {
        JsonService jsonService = ServiceLocator.locate(JsonService.class);
        String eventName = context.getEventName();
        JsonObject eventData = context.getData();

        try {
            JsonObject result;
            if ("query".equals(eventName)) {
                result = handleQuery(eventData, jsonService);
            } else if ("create".equals(eventName)) {
                result = handleCreate(eventData, jsonService);
            } else if ("update".equals(eventName)) {
                result = handleUpdate(eventData, jsonService);
            } else if ("delete".equals(eventName)) {
                result = handleDelete(eventData, jsonService);
            } else {
                return errorResponse(context, "Unknown event: " + eventName);
            }
            return context.newEventResponseBuilder().withData(result).build();
        } catch (RollbackException e) {
            return errorResponse(context, e.getMessage());
        }
    }

    /**
     * Handle "query" event
     * Payload: { vql: "SELECT id, name__v FROM team__c" }
     * Returns: { success: true, records: [ {...}, {...} ] }
     */
    private JsonObject handleQuery(JsonObject data, JsonService jsonService) {
        String vql = data.getValue("vql", JsonValueType.STRING);
        if (vql == null || vql.isEmpty()) {
            throw new RollbackException(ERR_BAD_INPUT, "Missing required parameter: vql");
        }

        assertVqlWhitelisted(vql);

        List<String> selectedFields = parseSelectFields(vql);

        QueryService queryService = ServiceLocator.locate(QueryService.class);
        QueryExecutionRequest request = queryService.newQueryExecutionRequestBuilder()
                .withQueryString(vql)
                .build();

        JsonArrayBuilder records = jsonService.newJsonArrayBuilder();
        final String[] queryError = { null };

        queryService.query(request)
                .onSuccess(response -> {
                    response.streamResults().forEach(row -> {
                        JsonObjectBuilder obj = jsonService.newJsonObjectBuilder();
                        for (String fieldName : selectedFields) {
                            obj.setValue(fieldName, readField(row, fieldName, jsonService));
                        }
                        records.add(obj.build());
                    });
                })
                .onError(err -> queryError[0] = err.getMessage())
                .execute();

        if (queryError[0] != null) {
            throw new RollbackException(ERR_OPERATION_FAILED, "Query failed: " + queryError[0]);
        }

        return jsonService.newJsonObjectBuilder()
                .setValue("success", true)
                .setValue("records", records.build())
                .build();
    }

    /**
     * Read a single field from a query result row. The ValueType is determined
     * by the hardcoded RetroVault schema (see fieldType()), avoiding the need
     * for QueryDescribe and type probing.
     */
    private Object readField(com.veeva.vault.sdk.api.query.QueryExecutionResult row,
                              String fieldName,
                              JsonService jsonService) {
        ValueType<?> type = fieldType(fieldName);

        if (type == ValueType.PICKLIST_VALUES) {
            // All RetroVault picklists are single-select. Flatten to a string
            // so the client can compare/assign directly (<select value={...} />).
            List<String> list = row.getValue(fieldName, ValueType.PICKLIST_VALUES);
            if (list == null || list.isEmpty()) {
                return null;
            }
            return list.get(0);
        }
        if (type == ValueType.DATE) {
            LocalDate d = row.getValue(fieldName, ValueType.DATE);
            return d == null ? null : d.toString();
        }
        if (type == ValueType.DATETIME) {
            ZonedDateTime dt = row.getValue(fieldName, ValueType.DATETIME);
            return dt == null ? null : dt.toString();
        }
        if (type == ValueType.NUMBER) {
            return row.getValue(fieldName, ValueType.NUMBER);
        }
        if (type == ValueType.BOOLEAN) {
            return row.getValue(fieldName, ValueType.BOOLEAN);
        }
        return row.getValue(fieldName, ValueType.STRING);
    }

    /**
     * Map a field name to its expected ValueType for the RetroVault schema.
     * Unknown fields default to STRING.
     */
    private ValueType<?> fieldType(String fieldName) {
        if ("status__c".equals(fieldName)
                || "category__c".equals(fieldName)
                || "theme__c".equals(fieldName)) {
            return ValueType.PICKLIST_VALUES;
        }
        if ("board_date__c".equals(fieldName) || "due_date__c".equals(fieldName)) {
            return ValueType.DATE;
        }
        if ("completed_at__c".equals(fieldName)) {
            return ValueType.DATETIME;
        }
        if ("vote_count__c".equals(fieldName)) {
            return ValueType.NUMBER;
        }
        return ValueType.STRING;
    }

    private com.veeva.vault.sdk.api.json.JsonArray toJsonArray(List<String> items, JsonService jsonService) {
        JsonArrayBuilder arr = jsonService.newJsonArrayBuilder();
        for (String item : items) {
            arr.add(item);
        }
        return arr.build();
    }

    /**
     * Parse the field list from the SELECT clause of a VQL query.
     * Example: "SELECT id, name__v, status__c FROM team__c" → [id, name__v, status__c].
     * Subqueries and function calls aren't supported here.
     */
    private List<String> parseSelectFields(String vql) {
        String upper = vql.toUpperCase();
        int selectIdx = upper.indexOf("SELECT");
        int fromIdx = upper.indexOf(" FROM ");
        if (selectIdx < 0 || fromIdx < 0 || fromIdx <= selectIdx) {
            throw new RollbackException(ERR_BAD_INPUT, "Cannot parse VQL SELECT clause");
        }
        String selectClause = vql.substring(selectIdx + "SELECT".length(), fromIdx).trim();
        List<String> fields = VaultCollections.newList();
        StringBuilder current = new StringBuilder();
        for (int i = 0; i < selectClause.length(); i++) {
            char c = selectClause.charAt(i);
            if (c == ',') {
                addField(fields, current.toString());
                current.setLength(0);
            } else {
                current.append(c);
            }
        }
        addField(fields, current.toString());
        return fields;
    }

    private void addField(List<String> fields, String token) {
        String name = token.trim();
        if (!name.isEmpty()) {
            fields.add(name);
        }
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
                    for (PositionalRecordId pri : successes) {
                        createdId[0] = pri.getRecordId();
                    }
                })
                .onErrors(errors -> {
                    if (!errors.isEmpty()) {
                        errorMsg[0] = errors.get(0).getError().getMessage();
                    }
                })
                .execute();

        if (errorMsg[0] != null) {
            throw new RollbackException(ERR_OPERATION_FAILED, "Create failed: " + errorMsg[0]);
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
            throw new RollbackException(ERR_BAD_INPUT, "Missing required parameter: id");
        }

        RecordService recordService = ServiceLocator.locate(RecordService.class);
        Record record = recordService.newRecordWithId(objectName, recordId);
        applyFields(record, fields);

        List<Record> records = VaultCollections.asList(record);
        final String[] errorMsg = { null };

        recordService.batchSaveRecords(records)
                .onErrors(errors -> {
                    if (!errors.isEmpty()) {
                        errorMsg[0] = errors.get(0).getError().getMessage();
                    }
                })
                .execute();

        if (errorMsg[0] != null) {
            throw new RollbackException(ERR_OPERATION_FAILED, "Update failed: " + errorMsg[0]);
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
            throw new RollbackException(ERR_BAD_INPUT, "Missing required parameter: id");
        }

        RecordService recordService = ServiceLocator.locate(RecordService.class);
        Record record = recordService.newRecordWithId(objectName, recordId);
        List<Record> records = VaultCollections.asList(record);
        final String[] errorMsg = { null };

        recordService.batchDeleteRecords(records)
                .onErrors(errors -> {
                    if (!errors.isEmpty()) {
                        errorMsg[0] = errors.get(0).getError().getMessage();
                    }
                })
                .execute();

        if (errorMsg[0] != null) {
            throw new RollbackException(ERR_OPERATION_FAILED, "Delete failed: " + errorMsg[0]);
        }

        return jsonService.newJsonObjectBuilder()
                .setValue("success", true)
                .build();
    }

    private void assertAllowed(String objectName) {
        if (!isAllowedObject(objectName)) {
            throw new RollbackException(ERR_NOT_ALLOWED, "Object not allowed: " + objectName);
        }
    }

    private boolean isAllowedObject(String objectName) {
        if (objectName == null) return false;
        return "team__c".equals(objectName)
                || "retro_board__c".equals(objectName)
                || "feedback_item__c".equals(objectName)
                || "action_item__c".equals(objectName)
                || "vote__c".equals(objectName)
                || "user__sys".equals(objectName);
    }

    private void assertVqlWhitelisted(String vql) {
        String upper = vql.toUpperCase();
        if (upper.contains(" FROM TEAM__C")
                || upper.contains(" FROM RETRO_BOARD__C")
                || upper.contains(" FROM FEEDBACK_ITEM__C")
                || upper.contains(" FROM ACTION_ITEM__C")
                || upper.contains(" FROM VOTE__C")
                || upper.contains(" FROM USER__SYS")) {
            return;
        }
        throw new RollbackException(ERR_NOT_ALLOWED, "Query must target an allowed object");
    }

    /**
     * Apply field values from a JsonObject to a Record. Strings are coerced to
     * the field's declared Java type (LocalDate for dates, ZonedDateTime for
     * datetimes, single-element list for picklists). JSON arrays are treated as
     * picklist value lists. JsonValueType is a parameterized interface (not an
     * enum), so we compare instances with ==.
     */
    private void applyFields(Record record, JsonObject fields) {
        if (fields == null) {
            return;
        }
        Map<String, JsonProperty> props = fields.getProperties();
        for (Map.Entry<String, JsonProperty> entry : props.entrySet()) {
            String fieldName = entry.getKey();
            JsonValueType<?> jsonType = entry.getValue().getJsonValueType();
            ValueType<?> fieldType = fieldType(fieldName);

            if (jsonType == JsonValueType.STRING) {
                String s = fields.getValue(fieldName, JsonValueType.STRING);
                record.setValue(fieldName, coerceString(s, fieldType));
            } else if (jsonType == JsonValueType.NUMBER) {
                BigDecimal num = fields.getValue(fieldName, JsonValueType.NUMBER);
                if (num != null) {
                    record.setValue(fieldName, num);
                }
            } else if (jsonType == JsonValueType.BOOLEAN) {
                record.setValue(fieldName, fields.getValue(fieldName, JsonValueType.BOOLEAN));
            } else if (jsonType == JsonValueType.ARRAY) {
                JsonArray arr = fields.getValue(fieldName, JsonValueType.ARRAY);
                if (arr != null) {
                    List<String> values = VaultCollections.newList();
                    for (int i = 0; i < arr.getSize(); i++) {
                        values.add(arr.getValue(i, JsonValueType.STRING));
                    }
                    record.setValue(fieldName, values);
                }
            }
        }
    }

    /**
     * Convert a JSON string into the Java type Vault expects for the field.
     * - DATE → LocalDate (parses ISO-8601 yyyy-MM-dd)
     * - DATETIME → ZonedDateTime (parses ISO-8601)
     * - PICKLIST_VALUES → single-element List<String>
     * - everything else → String unchanged
     */
    private Object coerceString(String value, ValueType<?> fieldType) {
        if (value == null) {
            return null;
        }
        if (fieldType == ValueType.DATE) {
            return LocalDate.parse(value);
        }
        if (fieldType == ValueType.DATETIME) {
            return ZonedDateTime.parse(value);
        }
        if (fieldType == ValueType.PICKLIST_VALUES) {
            List<String> list = VaultCollections.newList();
            list.add(value);
            return list;
        }
        return value;
    }

    private PageEventResponse errorResponse(PageEventContext context, String message) {
        return context.newEventErrorResponseBuilder()
                .withTitle("RetroVault error")
                .withUserMessage(message != null ? message : "Unknown error")
                .build();
    }
}
