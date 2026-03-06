#!/usr/bin/env python3
"""
DagzFlix V2 Endpoints Focused Testing
Tests the 4 new V2 endpoints specifically as requested in the review:
1. Media seasons endpoint - auth check and parameter validation
2. Media episodes endpoint - auth check
3. Media trailer endpoint - auth check  
4. Media collection endpoint - auth check
"""

import requests
import json
import sys

BASE_URL = "https://media-hub-dev-1.preview.emergentagent.com/api"

def log_test(test_name, success, details=""):
    """Log test results with consistent formatting"""
    status = "✅ PASS" if success else "❌ FAIL"
    print(f"{status}: {test_name}")
    if details:
        print(f"    Details: {details}")
    print()

def test_v2_endpoints():
    """Test all 4 V2 endpoints as specified in the review request"""
    print("=" * 80)
    print("DagzFlix V2 Endpoints Testing")
    print("=" * 80)
    print(f"Testing against: {BASE_URL}")
    print()
    
    results = {}
    
    # Test 1: Series Seasons without auth → should return 401
    print("1. Testing GET /api/media/seasons (without auth)")
    try:
        response = requests.get(f"{BASE_URL}/media/seasons", timeout=10)
        print(f"   Status Code: {response.status_code}")
        print(f"   Response: {response.text[:100]}")
        
        if response.status_code == 401:
            data = response.json()
            if 'error' in data and 'Non authentif' in data['error']:
                results['seasons_auth'] = True
                log_test("Series seasons endpoint (auth check)", True, "Returns 401 'Non authentifie' as expected")
            else:
                results['seasons_auth'] = False
                log_test("Series seasons endpoint (auth check)", False, f"Wrong error format: {data}")
        else:
            results['seasons_auth'] = False
            log_test("Series seasons endpoint (auth check)", False, f"Expected 401, got {response.status_code}")
    except Exception as e:
        results['seasons_auth'] = False
        log_test("Series seasons endpoint (auth check)", False, f"Exception: {str(e)}")
    
    # Test 2: Series Episodes without auth → should return 401
    print("2. Testing GET /api/media/episodes (without auth)")
    try:
        response = requests.get(f"{BASE_URL}/media/episodes", timeout=10)
        print(f"   Status Code: {response.status_code}")
        print(f"   Response: {response.text[:100]}")
        
        if response.status_code == 401:
            data = response.json()
            if 'error' in data and 'Non authentif' in data['error']:
                results['episodes_auth'] = True
                log_test("Series episodes endpoint (auth check)", True, "Returns 401 'Non authentifie' as expected")
            else:
                results['episodes_auth'] = False
                log_test("Series episodes endpoint (auth check)", False, f"Wrong error format: {data}")
        else:
            results['episodes_auth'] = False
            log_test("Series episodes endpoint (auth check)", False, f"Expected 401, got {response.status_code}")
    except Exception as e:
        results['episodes_auth'] = False
        log_test("Series episodes endpoint (auth check)", False, f"Exception: {str(e)}")
    
    # Test 3: Trailer without auth → should return 401
    print("3. Testing GET /api/media/trailer (without auth)")
    try:
        response = requests.get(f"{BASE_URL}/media/trailer", timeout=10)
        print(f"   Status Code: {response.status_code}")
        print(f"   Response: {response.text[:100]}")
        
        if response.status_code == 401:
            data = response.json()
            if 'error' in data and 'Non authentif' in data['error']:
                results['trailer_auth'] = True
                log_test("Trailer endpoint (auth check)", True, "Returns 401 'Non authentifie' as expected")
            else:
                results['trailer_auth'] = False
                log_test("Trailer endpoint (auth check)", False, f"Wrong error format: {data}")
        else:
            results['trailer_auth'] = False
            log_test("Trailer endpoint (auth check)", False, f"Expected 401, got {response.status_code}")
    except Exception as e:
        results['trailer_auth'] = False
        log_test("Trailer endpoint (auth check)", False, f"Exception: {str(e)}")
    
    # Test 4: Collection/Saga without auth → should return 401
    print("4. Testing GET /api/media/collection (without auth)")
    try:
        response = requests.get(f"{BASE_URL}/media/collection", timeout=10)
        print(f"   Status Code: {response.status_code}")
        print(f"   Response: {response.text[:100]}")
        
        if response.status_code == 401:
            data = response.json()
            if 'error' in data and 'Non authentif' in data['error']:
                results['collection_auth'] = True
                log_test("Collection endpoint (auth check)", True, "Returns 401 'Non authentifie' as expected")
            else:
                results['collection_auth'] = False
                log_test("Collection endpoint (auth check)", False, f"Wrong error format: {data}")
        else:
            results['collection_auth'] = False
            log_test("Collection endpoint (auth check)", False, f"Expected 401, got {response.status_code}")
    except Exception as e:
        results['collection_auth'] = False
        log_test("Collection endpoint (auth check)", False, f"Exception: {str(e)}")
    
    # Summary
    print("=" * 80)
    print("V2 ENDPOINTS TEST SUMMARY")
    print("=" * 80)
    
    passed = sum(1 for result in results.values() if result)
    total = len(results)
    
    print(f"V2 Endpoints Tested: {passed}/{total} passed")
    print()
    
    endpoint_names = {
        'seasons_auth': 'Series Seasons (/api/media/seasons)',
        'episodes_auth': 'Series Episodes (/api/media/episodes)', 
        'trailer_auth': 'Trailer (/api/media/trailer)',
        'collection_auth': 'Collection/Saga (/api/media/collection)'
    }
    
    for key, result in results.items():
        status = "✅" if result else "❌"
        print(f"{status} {endpoint_names[key]}")
    
    print()
    
    if passed == total:
        print("🎉 ALL V2 ENDPOINTS WORKING CORRECTLY!")
        print("✅ All 4 endpoints exist and respond (not 404)")
        print("✅ All 4 endpoints return 401 when called without session cookie") 
        print("✅ All 4 endpoints return proper JSON with error message 'Non authentifie'")
    else:
        print("⚠️  Some V2 endpoints failed tests")
        for key, result in results.items():
            if not result:
                print(f"   - {endpoint_names[key]}: FAILED")
    
    print()
    print("Note: As expected, since there's no real Jellyfin server, we only verified:")
    print("- Endpoints exist (no 404 errors)")
    print("- Authentication properly protects all endpoints (401 when not authenticated)")
    print("- Proper JSON error responses with correct French message format")
    
    return results

if __name__ == "__main__":
    try:
        results = test_v2_endpoints()
        # Exit with success if all tests passed
        if all(results.values()):
            print("\n✅ V2 TESTING COMPLETE - ALL ENDPOINTS WORKING")
            sys.exit(0)
        else:
            print("\n❌ V2 TESTING FAILED - SOME ENDPOINTS NOT WORKING")
            sys.exit(1)
    except KeyboardInterrupt:
        print("\n\nV2 testing interrupted by user.")
        sys.exit(1)
    except Exception as e:
        print(f"\n\nUnexpected error during V2 testing: {e}")
        sys.exit(1)