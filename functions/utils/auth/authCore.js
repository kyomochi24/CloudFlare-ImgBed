/**
 * 统一认证核心
 * 所有认证逻辑的单一来源，按优先级依次尝试各种认证方式
 */

import { fetchSecurityConfig } from '../sysConfig.js';
import { validateApiToken } from './tokenValidator.js';
import { getDatabase } from '../databaseAdapter.js';
import { validateSession } from './sessionManager.js';

/**
 * 认证范围常量
 * - 'admin'  : 仅管理员（admin session / API Token）
 * - 'user'   : 原版用户接口仅管理员会话 / 管理员 API Token 可用；Studio 用户使用独立接口
 * - 'either' : 管理员会话 / 管理员 API Token 可用
 */
export const AUTH_SCOPE = {
    ADMIN: 'admin',
    USER: 'user',
    EITHER: 'either',
};

const AUTHORIZED = (authType) => ({ authorized: true, authType });
const UNAUTHORIZED = { authorized: false, authType: null };

/**
 * 管理员会话认证
 * 检查 admin session
 *
 * @returns {Promise<{authorized: boolean, authType: string|null}|null>}
 *          认证通过返回结果，未通过返回 null（交给调用方继续）
 */
async function checkAdmin({ env, request, adminConfigured }) {
    if (!adminConfigured) {
        return AUTHORIZED('admin'); // 未配置管理员认证，视为管理员身份放行
    }

    const session = await validateSession(env, request, 'admin');
    if (session.valid) {
        return AUTHORIZED('admin');
    }

    return null;
}

/**
 * 原版用户接口只接受管理员会话，避免旧共用口令绕过 Studio 的个人额度。
 *
 * @returns {Promise<{authorized: boolean, authType: string|null}|null>}
 *          认证通过/失败返回结果，无法判定返回 null
 */
async function checkUser({ env, request }) {
    // admin session（管理员身份也可访问用户资源）
    const adminSession = await validateSession(env, request, 'admin');
    if (adminSession.valid) {
        return AUTHORIZED('admin');
    }

    // Studio 用户只通过 /api/studio/* 操作自己的相册和额度。
    // 旧版共用 user_session / authCode 不绑定个人额度，不能继续进入上传接口。
    return UNAUTHORIZED;
}

/**
 * 统一认证函数
 *
 * @param {Object} options
 * @param {Object} options.env - 环境变量
 * @param {Request} options.request - 请求对象
 * @param {URL} [options.url] - 请求URL（authCode 提取需要）
 * @param {string|null} [options.requiredPermission] - API Token 所需权限
 * @param {'admin'|'user'|'either'} [options.authScope='either'] - 认证范围
 * @returns {Promise<{authorized: boolean, authType: 'admin'|'user'|null}>}
 */
export async function authenticate({
    env,
    request,
    url = null,
    requiredPermission = null,
    authScope = AUTH_SCOPE.EITHER,
}) {
    // 读取安全配置
    const securityConfig = await fetchSecurityConfig(env);
    const adminUsername = securityConfig.auth.admin.adminUsername;
    const adminPassword = securityConfig.auth.admin.adminPassword;
    const adminConfigured = !!(adminUsername && adminUsername.trim()) || !!(adminPassword && adminPassword.trim());

    // --- API Token 验证（公共层，所有 scope 通用） ---
    const db = getDatabase(env);
    const tokenResult = await validateApiToken(request, db, requiredPermission);
    if (tokenResult.valid) {
        return AUTHORIZED('admin');
    }

    // --- 会话/凭据验证 ---
    const adminCtx = { env, request, adminConfigured };
    const userCtx = { env, request };

    if (authScope === AUTH_SCOPE.ADMIN) {
        return (await checkAdmin(adminCtx)) || UNAUTHORIZED;
    }

    if (authScope === AUTH_SCOPE.USER) {
        return await checkUser(userCtx);
    }

    // EITHER: 任一通过即可
    const adminResult = await checkAdmin(adminCtx);
    if (adminResult?.authorized) return adminResult;

    return await checkUser(userCtx);
}
