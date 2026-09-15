package com.madazi.system.service.impl;

import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import com.madazi.system.domain.SysNotice;
import com.madazi.system.domain.SysNoticeRead;
import com.madazi.system.mapper.SysNoticeReadMapper;
import com.madazi.system.service.ISysNoticeReadService;
import com.madazi.common.utils.uuid.IdUtils;

/**
 * 公告已读记录 服务层实现
 *
 * @author madazi
 */
@Service
public class SysNoticeReadServiceImpl implements ISysNoticeReadService
{
    @Autowired
    private SysNoticeReadMapper noticeReadMapper;

    /**
     * 标记已读
     */
    @Override
    public void markRead(String noticeId, String userId)
    {
        SysNoticeRead record = new SysNoticeRead();

        record.setReadId(IdUtils.fastSimpleUUID());
        record.setNoticeId(noticeId);
        record.setUserId(userId);
        noticeReadMapper.insertNoticeRead(record);
    }

    /**
     * 查询某用户未读公告数量
     */
    @Override
    public int selectUnreadCount(String userId)
    {
        return noticeReadMapper.selectUnreadCount(userId);
    }

    /**
     * 查询公告列表并标记当前用户已读状态
     */
    @Override
    public List<SysNotice> selectNoticeListWithReadStatus(String userId, int limit)
    {
        return noticeReadMapper.selectNoticeListWithReadStatus(userId, limit);
    }

    /**
     * 批量标记已读
     */
    @Override
    public void markReadBatch(String userId, String[] noticeIds)
    {
        if (noticeIds == null || noticeIds.length == 0)
        {
            return;
        }
        noticeReadMapper.insertNoticeReadBatch(userId, noticeIds);
    }

    /**
     * 查询已阅读某公告的用户列表
     */
    @Override
    public List<Map<String, Object>> selectReadUsersByNoticeId(String noticeId, String searchValue)
    {
        return noticeReadMapper.selectReadUsersByNoticeId(noticeId, searchValue);
    }

    /**
     * 删除公告时清理对应已读记录
     */
    @Override
    public void deleteByNoticeIds(String[] noticeIds)
    {
        noticeReadMapper.deleteByNoticeIds(noticeIds);
    }
}
