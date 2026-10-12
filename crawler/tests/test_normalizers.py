from apsi_crawler.normalizers.bids import normalize_sam_gov_opportunity
import pytest


def test_normalize_sam_gov_opportunity():
    raw = {
        "noticeId": "abc-123",
        "title": "Enterprise Cloud Migration Services",
        "solicitationNumber": "DOD-CLOUD-2026",
        "department": "DEPARTMENT OF DEFENSE",
        "postedDate": "2026-05-01",
        "responseDeadLine": "2026-06-15T17:00:00-05:00",
        "uiLink": "https://sam.gov/opp/abc-123/view",
        "type": "Solicitation",
    }

    bid = normalize_sam_gov_opportunity(raw)

    assert bid["source"] == "SAM.gov"
    assert bid["source_bid_id"] == "abc-123"
    assert bid["title"] == "Enterprise Cloud Migration Services"
    assert bid["issuer_type"] == "federal"
    assert bid["state_code"] == "US"
    assert bid["source_url"] == "https://sam.gov/opp/abc-123/view"


def test_sam_description_endpoint_is_not_displayable_body_text():
    bid = normalize_sam_gov_opportunity({
        "noticeId": "abc-123", "title": "Cloud services", "type": "Solicitation",
        "description": "https://api.sam.gov/prod/opportunities/v1/noticedesc?noticeid=abc-123",
    })
    assert bid["description"] == ""
    assert not bid["full_description"]


def test_sam_current_v2_agency_contact_and_resources_are_not_discarded():
    raw = {
        "noticeId": "abc-123", "title": "Road repairs", "type": "Solicitation",
        "fullParentPathName": "DEPARTMENT OF DEFENSE.DEPARTMENT OF THE ARMY.CONTRACTING OFFICE",
        "uiLink": "https://sam.gov/opp/abc-123/view",
        "pointOfContact": [{"type": "secondary", "fullName": "Secondary buyer"},
                           {"type": "primary", "fullName": "Primary buyer", "email": "buyer@example.gov", "phone": "555-0100"}],
        "resourceLinks": ["https://sam.gov/resources/abc-123/scope.pdf", "javascript:alert(1)"],
    }
    bid = normalize_sam_gov_opportunity(raw)
    assert bid["issuer_name"] == raw["fullParentPathName"]
    assert bid["contact_name"] == "Primary buyer"
    assert bid["contact_email"] == "buyer@example.gov"
    assert bid["attachments"] == [{"name": "scope.pdf", "url": raw["resourceLinks"][0], "original_url": raw["resourceLinks"][0], "archive_status": "not_archived"}]
    assert "invalid_attachment_url" in bid["quality_flags_json"]
    assert bid["description"] == ""


@pytest.mark.parametrize("active,notice_type,expected", [("No", "Solicitation", "closed"), ("Yes", "Award Notice", "awarded"), ("Yes", "Solicitation", "open")])
def test_sam_lifecycle_uses_actual_active_and_award_fields(active, notice_type, expected):
    bid = normalize_sam_gov_opportunity({
        "noticeId": "abc-123", "title": "Road repairs", "active": active, "type": notice_type,
        "solicitationNumber": "RFP-001", "award": {"date": "2026-09-29"},
    })
    assert bid["lifecycle_status"] == expected
    assert bid["is_active"] == (1 if expected == "open" else 0)
    assert bid["solicitation_number"] == "RFP-001"


def test_sam_rejects_missing_notice_identity_instead_of_creating_none_id():
    with pytest.raises(ValueError, match="identity"):
        normalize_sam_gov_opportunity({"title": "Road repairs"})
