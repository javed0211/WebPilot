import re
from playwright.sync_api import Page, expect
from tests.generated.pages.wikipedia_home_page import WikipediaHomePage
from tests.generated.pages.wikipedia_software_testing_page import WikipediaSoftwareTestingPage


def test_wikipedia_complex_dom_verification(page: Page):
    wikipediaHomePage = WikipediaHomePage(page)
    wikipediaHomePage.goto()
    wikipediaHomePage.fill_search_wikipedia()
    wikipediaHomePage.click_search_button()
    wikipediaSoftwareTestingPage = WikipediaSoftwareTestingPage(page)
    wikipediaSoftwareTestingPage.click_view_history_link()
    page.go_back()
    wikipediaSoftwareTestingPage.capture_page_screenshot()
    wikipediaSoftwareTestingPage.click_talk_link()
    wikipediaHomePage.assert_wikipedia_homepage_loads_successfully()
    wikipediaHomePage.assert_search_wikipedia()
    wikipediaHomePage.assert_page_url_contains_software_testing()
    wikipediaSoftwareTestingPage.assert_software_testing()
    wikipediaSoftwareTestingPage.assert_from_wikipedia_the_free_encyclopedia()
    wikipediaSoftwareTestingPage.assert_article()
    wikipediaSoftwareTestingPage.assert_revision_history()
    wikipediaSoftwareTestingPage.assert_see_also_section()
    wikipediaSoftwareTestingPage.assert_references_section()
    wikipediaSoftwareTestingPage.assert_external_links_section()
    wikipediaSoftwareTestingPage.assert_wikipedia()
    page.screenshot(path="runtime/artifacts/capture_capture_screenshot_of_the_software_testing_heading.png")
    wikipediaHomePage.assert_page_url_contains_talk()
    wikipediaSoftwareTestingPage.assert_categories()
    wikipediaSoftwareTestingPage.assert_this_page_was_last_edited()
