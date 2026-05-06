const API_URL = 'http://localhost:5000/api/projects';

const testProject = {
  reportId: 'TMP-TEST-123',
  projectName: 'Test Traffic Plan',
  permitNumber: 'PERMIT-001',
  contractorName: 'Build Corp',
  clientName: 'City Council',
  startDate: '2026-03-10',
  endDate: '2026-03-15',
  workingHours: '09:00-17:00',
  nightWork: false,
  superintendent: 'John Doe',
  safetyOfficer: 'Jane Smith',
  emergencyContact: '9999999999',
  isWazeSync: true,
  zones: [
    {
      name: 'Zone 1',
      color: '#0ea5e9',
      shapeType: 'polygon',
      coords: [
        { lat: 28.6139, lng: 77.2090 },
        { lat: 28.6140, lng: 77.2091 },
        { lat: 28.6141, lng: 77.2090 }
      ],
      approachEdgeIndices: [0],
      speedLimit: '50',
      workZoneSpeed: '30',
      hasGenerated: true,
      placedAssets: [
        { id: 'asset-1', type: 'cone', source: 'auto', lat: 28.61395, lng: 77.20905 }
      ]
    }
  ]
};

async function runTest() {
  try {
    console.log('--- Testing Save Project ---');
    const saveRes = await fetch(`${API_URL}/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testProject)
    });
    const saveData = await saveRes.json();
    console.log('Save Response:', saveData);

    console.log('\n--- Testing Load Project ---');
    const loadRes = await fetch(`${API_URL}/TMP-TEST-123`);
    const loadData = await loadRes.json();
    console.log('Load Response (Name):', loadData.name);
    console.log('Load Response (Zones Count):', loadData.zones.length);
    console.log('Load Response (Asset Lat):', loadData.zones[0].placedAssets[0].lat);

    console.log('Load Response (isWazeSync):', loadData.isWazeSync, typeof loadData.isWazeSync);
    console.log('Load Response (Asset Type):', loadData.zones[0].placedAssets[0].type);

    if (loadData.isWazeSync === true && loadData.zones[0].placedAssets[0].type === 'cone') {
      console.log('\n✅ API TEST PASSED');
    } else {
      console.log('\n❌ API TEST FAILED: Data mismatch');
    }
  } catch (error) {
    console.error('API Test Error:', error.message);
  }
}

runTest();
