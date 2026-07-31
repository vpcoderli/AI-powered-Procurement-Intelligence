"""适配器注册表。

解析顺序:先查 source_id 的专用适配器,再按 provider_family 取平台适配器,
都未命中则显式抛错。绝不静默跳过——2000 源规模下静默跳过会让你无法
察觉哪些源没有在运行。
"""

from apsi_crawler.spiders.bonfire import fetch_bonfire_opportunities
from apsi_crawler.spiders.ca_caleprocure import fetch_ca_caleprocure_opportunities
from apsi_crawler.spiders.co_bidnet import fetch_bidnet_opportunities
from apsi_crawler.spiders.fl_mfmp import fetch_fl_mfmp_opportunities
from apsi_crawler.spiders.generic_state import fetch_generic_state_opportunities
from apsi_crawler.spiders.il_bidbuy import fetch_il_bidbuy_opportunities
from apsi_crawler.spiders.ny_contract_reporter import fetch_ny_contract_reporter_opportunities
from apsi_crawler.spiders.tx_esbd import fetch_tx_esbd_opportunities


class AdapterNotFoundError(Exception):
    pass


def fetch_bidnet_platform(source, query=None, limit=25, **kwargs):
    """bidnet 平台适配器包装。

    fetch_task 统一以 adapter(source, query=query, limit=limit) 调用注册表里的每个
    适配器(见 cli.py)。但 fetch_bidnet_opportunities 的真实签名要求位置参数
    url,直接把它绑进 PLATFORM_ADAPTERS 会在每次 bidnet 源调用时抛
    `TypeError: fetch_bidnet_opportunities() missing 1 required positional
    argument: 'url'`。这里从 source.fetch_config.base_url 取 BidNet Direct 聚合页
    地址再转发,使其符合统一调用约定;**kwargs 继续透传 fixture_html/session/
    timeout 等可选参数。
    """
    url = source.fetch_config.get("base_url")
    if not url:
        raise ValueError(f"bidnet source {source.id} has no fetch_config.base_url")

    return fetch_bidnet_opportunities(source, url, query=query, limit=limit, **kwargs)


# 商业平台:一个适配器服务 N 个租户。阶段 2a 追加 bonfire;ionwave 等仍待办。
PLATFORM_ADAPTERS = {
    "bidnet": fetch_bidnet_platform,
    "generic": fetch_generic_state_opportunities,
    "bonfire": fetch_bonfire_opportunities,  # Phase 2a
}

# 自建门户:一源一适配器,仅大型行政区值得。
DEDICATED_ADAPTERS = {
    "ca_caleprocure": fetch_ca_caleprocure_opportunities,
    "tx_esbd": fetch_tx_esbd_opportunities,
    "ny_contract_reporter": fetch_ny_contract_reporter_opportunities,
    "fl_mfmp": fetch_fl_mfmp_opportunities,
    "il_bidbuy": fetch_il_bidbuy_opportunities,
}


def resolve_adapter(source_id, provider_family):
    dedicated = DEDICATED_ADAPTERS.get(source_id)
    if dedicated is not None:
        return dedicated

    if provider_family:
        platform = PLATFORM_ADAPTERS.get(provider_family)
        if platform is not None:
            return platform

    raise AdapterNotFoundError(
        f"No adapter for source_id={source_id!r} provider_family={provider_family!r}"
    )
