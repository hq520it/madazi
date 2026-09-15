package com.madazi.common.exception.user;

/**
 * 黑名单IP异常类
 * 
 * @author madazi
 */
public class BlackListException extends UserException
{
    private static final long serialVersionUID = 1L;

    public BlackListException()
    {
        super("login.blocked", null);
    }
}
