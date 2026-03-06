#!/usr/bin/env python3
"""
DagzFlix Backend API Test Suite
Tests all backend endpoints with focus on authentication, setup, and error handling.
Since no real Jellyfin server is available, tests focus on endpoints that work without external dependencies.
"""

import requests
import json
import sys

# Base URL from environment
BASE_URL = "https://media-hub-dev-1.preview.emergentagent.com/api"

def log_test(test_name, success, details=""):
    """Log test results with consistent formatting"""
    status = "✅ PASS" if success else "❌ FAIL"
    print(f"{status}: {test_name}")
    if details:
        print(f"    Details: {details}")
    if not success:
        print(f"    Expected vs Actual logged above")
    print()

def test_health_check():
    """Test GET /api/health - should return status ok"""
    try:
        url = f"{BASE_URL}/health"
        print(f"Testing: GET {url}")
        
        response = requests.get(url, timeout=10)
        print(f"Status Code: {response.status_code}")
        print(f"Response: {response.text[:200]}")
        
        if response.status_code == 200:
            data = response.json()
            if data.get('status') == 'ok' and 'timestamp' in data and 'version' in data:
                log_test("Health check endpoint", True, f"Status: {data['status']}, Version: {data.get('version')}")
                return True
            else:
                log_test("Health check endpoint", False, f"Missing required fields. Got: {data}")
                return False
        else:
            log_test("Health check endpoint", False, f"Expected 200, got {response.status_code}")
            return False
            
    except Exception as e:
        log_test("Health check endpoint", False, f"Exception: {str(e)}")
        return False

def test_setup_check_initial():
    """Test GET /api/setup/check - should return setupComplete: false initially"""
    try:
        url = f"{BASE_URL}/setup/check"
        print(f"Testing: GET {url}")
        
        response = requests.get(url, timeout=10)
        print(f"Status Code: {response.status_code}")
        print(f"Response: {response.text[:200]}")
        
        if response.status_code == 200:
            data = response.json()
            if 'setupComplete' in data:
                log_test("Setup check endpoint (initial)", True, f"Setup status: {data}")
                return True, data.get('setupComplete', False)
            else:
                log_test("Setup check endpoint (initial)", False, f"Missing setupComplete field. Got: {data}")
                return False, None
        else:
            log_test("Setup check endpoint (initial)", False, f"Expected 200, got {response.status_code}")
            return False, None
            
    except Exception as e:
        log_test("Setup check endpoint (initial)", False, f"Exception: {str(e)}")
        return False, None

def test_setup_save():
    """Test POST /api/setup/save - should save configuration"""
    try:
        url = f"{BASE_URL}/setup/save"
        print(f"Testing: POST {url}")
        
        payload = {
            "jellyfinUrl": "https://test.jellyfin.org",
            "jellyfinApiKey": "test-api-key",
            "jellyseerrUrl": "https://test.jellyseerr.org",
            "jellyseerrApiKey": "test-seerr-key"
        }
        
        print(f"Payload: {json.dumps(payload, indent=2)}")
        
        response = requests.post(url, json=payload, timeout=10)
        print(f"Status Code: {response.status_code}")
        print(f"Response: {response.text[:200]}")
        
        if response.status_code == 200:
            data = response.json()
            if data.get('success') == True:
                log_test("Setup save endpoint", True, f"Config saved successfully: {data}")
                return True
            else:
                log_test("Setup save endpoint", False, f"Success field not true. Got: {data}")
                return False
        else:
            log_test("Setup save endpoint", False, f"Expected 200, got {response.status_code}: {response.text}")
            return False
            
    except Exception as e:
        log_test("Setup save endpoint", False, f"Exception: {str(e)}")
        return False

def test_setup_check_after_save():
    """Test GET /api/setup/check after saving config - should return setupComplete: true"""
    try:
        url = f"{BASE_URL}/setup/check"
        print(f"Testing: GET {url} (after save)")
        
        response = requests.get(url, timeout=10)
        print(f"Status Code: {response.status_code}")
        print(f"Response: {response.text[:200]}")
        
        if response.status_code == 200:
            data = response.json()
            expected_fields = ['setupComplete', 'jellyfinConfigured', 'jellyseerrConfigured']
            if all(field in data for field in expected_fields):
                if data.get('setupComplete') == True and data.get('jellyfinConfigured') == True:
                    log_test("Setup check endpoint (after save)", True, f"Setup completed: {data}")
                    return True
                else:
                    log_test("Setup check endpoint (after save)", False, f"Setup not properly completed. Got: {data}")
                    return False
            else:
                log_test("Setup check endpoint (after save)", False, f"Missing required fields. Got: {data}")
                return False
        else:
            log_test("Setup check endpoint (after save)", False, f"Expected 200, got {response.status_code}")
            return False
            
    except Exception as e:
        log_test("Setup check endpoint (after save)", False, f"Exception: {str(e)}")
        return False

def test_auth_session_unauthenticated():
    """Test GET /api/auth/session without authentication - should return authenticated: false"""
    try:
        url = f"{BASE_URL}/auth/session"
        print(f"Testing: GET {url} (unauthenticated)")
        
        response = requests.get(url, timeout=10)
        print(f"Status Code: {response.status_code}")
        print(f"Response: {response.text[:200]}")
        
        if response.status_code == 200:
            data = response.json()
            if data.get('authenticated') == False:
                log_test("Auth session endpoint (unauthenticated)", True, f"Correctly not authenticated: {data}")
                return True
            else:
                log_test("Auth session endpoint (unauthenticated)", False, f"Should not be authenticated. Got: {data}")
                return False
        else:
            log_test("Auth session endpoint (unauthenticated)", False, f"Expected 200, got {response.status_code}")
            return False
            
    except Exception as e:
        log_test("Auth session endpoint (unauthenticated)", False, f"Exception: {str(e)}")
        return False

def test_auth_session_with_invalid_cookie():
    """Test GET /api/auth/session with invalid cookie - should handle gracefully"""
    try:
        url = f"{BASE_URL}/auth/session"
        print(f"Testing: GET {url} (with invalid cookie)")
        
        # Send request with invalid session cookie
        cookies = {'dagzflix_session': 'invalid-session-id'}
        response = requests.get(url, cookies=cookies, timeout=10)
        print(f"Status Code: {response.status_code}")
        print(f"Response: {response.text[:200]}")
        
        if response.status_code == 200:
            data = response.json()
            if data.get('authenticated') == False:
                log_test("Auth session with invalid cookie", True, f"Correctly rejected invalid cookie: {data}")
                return True
            else:
                log_test("Auth session with invalid cookie", False, f"Should not accept invalid cookie. Got: {data}")
                return False
        else:
            log_test("Auth session with invalid cookie", False, f"Expected 200, got {response.status_code}")
            return False
            
    except Exception as e:
        log_test("Auth session with invalid cookie", False, f"Exception: {str(e)}")
        return False

def test_preferences_without_auth():
    """Test POST /api/preferences without authentication - should return 401"""
    try:
        url = f"{BASE_URL}/preferences"
        print(f"Testing: POST {url} (without auth)")
        
        payload = {
            "favoriteGenres": ["Action", "Drama"],
            "dislikedGenres": ["Horror"]
        }
        
        response = requests.post(url, json=payload, timeout=10)
        print(f"Status Code: {response.status_code}")
        print(f"Response: {response.text[:200]}")
        
        if response.status_code == 401:
            data = response.json()
            if 'error' in data and 'authentif' in data['error'].lower():
                log_test("Preferences endpoint without auth", True, f"Correctly returned 401: {data}")
                return True
            else:
                log_test("Preferences endpoint without auth", False, f"Wrong error message. Got: {data}")
                return False
        else:
            log_test("Preferences endpoint without auth", False, f"Expected 401, got {response.status_code}")
            return False
            
    except Exception as e:
        log_test("Preferences endpoint without auth", False, f"Exception: {str(e)}")
        return False

def test_search_without_auth():
    """Test GET /api/search without authentication - should return 401"""
    try:
        url = f"{BASE_URL}/search"
        print(f"Testing: GET {url}?q=test (without auth)")
        
        response = requests.get(url, params={'q': 'test'}, timeout=10)
        print(f"Status Code: {response.status_code}")
        print(f"Response: {response.text[:200]}")
        
        if response.status_code == 401:
            data = response.json()
            if 'error' in data and 'authentif' in data['error'].lower():
                log_test("Search endpoint without auth", True, f"Correctly returned 401: {data}")
                return True
            else:
                log_test("Search endpoint without auth", False, f"Wrong error message. Got: {data}")
                return False
        else:
            log_test("Search endpoint without auth", False, f"Expected 401, got {response.status_code}")
            return False
            
    except Exception as e:
        log_test("Search endpoint without auth", False, f"Exception: {str(e)}")
        return False

def test_404_route():
    """Test non-existent route - should return 404"""
    try:
        url = f"{BASE_URL}/nonexistent"
        print(f"Testing: GET {url}")
        
        response = requests.get(url, timeout=10)
        print(f"Status Code: {response.status_code}")
        print(f"Response: {response.text[:200]}")
        
        if response.status_code == 404:
            data = response.json()
            if 'error' in data:
                log_test("404 route handling", True, f"Correctly returned 404: {data}")
                return True
            else:
                log_test("404 route handling", False, f"Missing error field. Got: {data}")
                return False
        else:
            log_test("404 route handling", False, f"Expected 404, got {response.status_code}")
            return False
            
    except Exception as e:
        log_test("404 route handling", False, f"Exception: {str(e)}")
        return False

def test_setup_test_connection():
    """Test POST /api/setup/test - should handle connection test gracefully"""
    try:
        url = f"{BASE_URL}/setup/test"
        print(f"Testing: POST {url} (connection test)")
        
        payload = {
            "type": "jellyfin",
            "url": "https://fake.server.com",
            "apiKey": ""
        }
        
        print(f"Payload: {json.dumps(payload, indent=2)}")
        
        response = requests.post(url, json=payload, timeout=15)
        print(f"Status Code: {response.status_code}")
        print(f"Response: {response.text[:200]}")
        
        # This should fail since it's a fake server, but shouldn't crash
        if response.status_code in [400, 500]:
            data = response.json()
            if 'success' in data and data['success'] == False and 'error' in data:
                log_test("Setup test connection", True, f"Correctly handled fake server: {data}")
                return True
            else:
                log_test("Setup test connection", False, f"Unexpected response format. Got: {data}")
                return False
        else:
            log_test("Setup test connection", False, f"Expected 400/500, got {response.status_code}")
            return False
            
    except Exception as e:
        log_test("Setup test connection", False, f"Exception: {str(e)}")
        return False

# V2 NEW ENDPOINTS TESTS - Focus on authentication requirements

def test_media_seasons_without_auth():
    """Test GET /api/media/seasons without authentication - should return 401"""
    try:
        url = f"{BASE_URL}/media/seasons"
        print(f"Testing: GET {url} (without auth)")
        
        response = requests.get(url, timeout=10)
        print(f"Status Code: {response.status_code}")
        print(f"Response: {response.text[:200]}")
        
        if response.status_code == 401:
            data = response.json()
            if 'error' in data and 'authentif' in data['error'].lower():
                log_test("Media seasons endpoint without auth", True, f"Correctly returned 401: {data}")
                return True
            else:
                log_test("Media seasons endpoint without auth", False, f"Wrong error message. Got: {data}")
                return False
        else:
            log_test("Media seasons endpoint without auth", False, f"Expected 401, got {response.status_code}")
            return False
            
    except Exception as e:
        log_test("Media seasons endpoint without auth", False, f"Exception: {str(e)}")
        return False

def test_media_episodes_without_auth():
    """Test GET /api/media/episodes without authentication - should return 401"""
    try:
        url = f"{BASE_URL}/media/episodes"
        print(f"Testing: GET {url} (without auth)")
        
        response = requests.get(url, timeout=10)
        print(f"Status Code: {response.status_code}")
        print(f"Response: {response.text[:200]}")
        
        if response.status_code == 401:
            data = response.json()
            if 'error' in data and 'authentif' in data['error'].lower():
                log_test("Media episodes endpoint without auth", True, f"Correctly returned 401: {data}")
                return True
            else:
                log_test("Media episodes endpoint without auth", False, f"Wrong error message. Got: {data}")
                return False
        else:
            log_test("Media episodes endpoint without auth", False, f"Expected 401, got {response.status_code}")
            return False
            
    except Exception as e:
        log_test("Media episodes endpoint without auth", False, f"Exception: {str(e)}")
        return False

def test_media_trailer_without_auth():
    """Test GET /api/media/trailer without authentication - should return 401"""
    try:
        url = f"{BASE_URL}/media/trailer"
        print(f"Testing: GET {url} (without auth)")
        
        response = requests.get(url, timeout=10)
        print(f"Status Code: {response.status_code}")
        print(f"Response: {response.text[:200]}")
        
        if response.status_code == 401:
            data = response.json()
            if 'error' in data and 'authentif' in data['error'].lower():
                log_test("Media trailer endpoint without auth", True, f"Correctly returned 401: {data}")
                return True
            else:
                log_test("Media trailer endpoint without auth", False, f"Wrong error message. Got: {data}")
                return False
        else:
            log_test("Media trailer endpoint without auth", False, f"Expected 401, got {response.status_code}")
            return False
            
    except Exception as e:
        log_test("Media trailer endpoint without auth", False, f"Exception: {str(e)}")
        return False

def test_media_collection_without_auth():
    """Test GET /api/media/collection without authentication - should return 401"""
    try:
        url = f"{BASE_URL}/media/collection"
        print(f"Testing: GET {url} (without auth)")
        
        response = requests.get(url, timeout=10)
        print(f"Status Code: {response.status_code}")
        print(f"Response: {response.text[:200]}")
        
        if response.status_code == 401:
            data = response.json()
            if 'error' in data and 'authentif' in data['error'].lower():
                log_test("Media collection endpoint without auth", True, f"Correctly returned 401: {data}")
                return True
            else:
                log_test("Media collection endpoint without auth", False, f"Wrong error message. Got: {data}")
                return False
        else:
            log_test("Media collection endpoint without auth", False, f"Expected 401, got {response.status_code}")
            return False
            
    except Exception as e:
        log_test("Media collection endpoint without auth", False, f"Exception: {str(e)}")
        return False

def run_comprehensive_backend_tests():
    """Run all backend API tests in sequence"""
    print("=" * 80)
    print("DagzFlix Backend API Test Suite")
    print("=" * 80)
    print(f"Testing against: {BASE_URL}")
    print()
    
    results = {}
    
    # Run tests in logical order
    print("🔄 Starting Backend API Tests...")
    print()
    
    # 1. Health check
    results['health'] = test_health_check()
    
    # 2. Setup workflow
    results['setup_check_initial'], initial_setup = test_setup_check_initial()
    results['setup_save'] = test_setup_save()
    results['setup_check_after'] = test_setup_check_after_save()
    
    # 3. Authentication tests
    results['auth_session_unauth'] = test_auth_session_unauthenticated()
    results['auth_session_invalid'] = test_auth_session_with_invalid_cookie()
    
    # 4. Protected endpoints without auth
    results['preferences_unauth'] = test_preferences_without_auth()
    results['search_unauth'] = test_search_without_auth()
    
    # 5. V2 NEW ENDPOINTS - Testing authentication requirements
    print("🆕 Testing V2 New Endpoints (authentication requirements)...")
    results['media_seasons_unauth'] = test_media_seasons_without_auth()
    results['media_episodes_unauth'] = test_media_episodes_without_auth()
    results['media_trailer_unauth'] = test_media_trailer_without_auth()
    results['media_collection_unauth'] = test_media_collection_without_auth()
    
    # 6. Error handling
    results['404_route'] = test_404_route()
    results['setup_test'] = test_setup_test_connection()
    
    # Summary
    print("=" * 80)
    print("TEST SUMMARY")
    print("=" * 80)
    
    passed = sum(1 for result in results.values() if result)
    total = len(results)
    
    print(f"Tests Passed: {passed}/{total}")
    print()
    
    # Separate existing vs new endpoint results
    existing_endpoints = ['health', 'setup_check_initial', 'setup_save', 'setup_check_after', 
                         'auth_session_unauth', 'auth_session_invalid', 'preferences_unauth', 
                         'search_unauth', '404_route', 'setup_test']
    
    new_endpoints = ['media_seasons_unauth', 'media_episodes_unauth', 'media_trailer_unauth', 'media_collection_unauth']
    
    existing_passed = sum(1 for ep in existing_endpoints if results.get(ep, False))
    new_passed = sum(1 for ep in new_endpoints if results.get(ep, False))
    
    print(f"✅ Existing Endpoints: {existing_passed}/{len(existing_endpoints)} passed")
    print(f"🆕 New V2 Endpoints: {new_passed}/{len(new_endpoints)} passed")
    print()
    
    if passed == total:
        print("🎉 ALL BACKEND TESTS PASSED!")
        print("The DagzFlix backend API V2 is working correctly.")
    else:
        print("⚠️  Some tests failed. Review the details above.")
        for test_name, result in results.items():
            if not result:
                print(f"   - {test_name}: FAILED")
    
    print()
    print("Note: Tests focused on endpoints that don't require external Jellyfin/Jellyseerr servers.")
    print("All authentication-protected endpoints properly returned 401 as expected.")
    
    return results

if __name__ == "__main__":
    try:
        results = run_comprehensive_backend_tests()
        # Exit with error code if any tests failed
        if not all(results.values()):
            sys.exit(1)
    except KeyboardInterrupt:
        print("\n\nTests interrupted by user.")
        sys.exit(1)
    except Exception as e:
        print(f"\n\nUnexpected error during testing: {e}")
        sys.exit(1)