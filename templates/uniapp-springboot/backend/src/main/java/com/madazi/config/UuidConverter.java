package com.madazi.config;

import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;
import java.util.UUID;

/**
 * UUID <-> String 自动转换（PostgreSQL UUID 列与 Java String 实体字段互转）
 */
@Converter(autoApply = true)
public class UuidConverter implements AttributeConverter<String, Object> {
    @Override
    public Object convertToDatabaseColumn(String uuid) {
        return uuid == null ? null : java.util.UUID.fromString(uuid);
    }
    @Override
    public String convertToEntityAttribute(Object dbValue) {
        return dbValue == null ? null : dbValue.toString();
    }
}
