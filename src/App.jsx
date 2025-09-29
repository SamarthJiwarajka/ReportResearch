import React, { useState, useEffect } from 'react';
import { Layout, Input, Button, Card, Spin, Space, Typography, notification, Tag } from 'antd';
import { SearchOutlined, LoadingOutlined, WarningOutlined } from '@ant-design/icons';

// --- FIREBASE IMPORTS ---
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, addDoc, getDocs, doc, updateDoc } from 'firebase/firestore'; 
import { setLogLevel } from 'firebase/firestore';

setLogLevel('debug'); // Enable debug logging for Firestore

const { Content, Footer } = Layout;
const { Title, Paragraph } = Typography;

// --- GLOBAL VARIABLES SETUP (REQUIRED FOR LOCAL DEVELOPMENT) ---
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

// 🚨 1. FIREBASE CONFIGURATION:
// If you are running this locally, you must replace the content of this `userProvidedConfig` object
// with the actual configuration object you copied from the Firebase console.
const userProvidedConfig = {
apiKey: "AIzaSyAeXNzjwkghoIvhRJ8VdFrVVgSM__czRd4",
authDomain: "ai-project-reports.firebaseapp.com",
projectId: "ai-project-reports",
storageBucket: "ai-project-reports.firebasestorage.app",
messagingSenderId: "617306238119",
appId: "1:617306238119:web:37b4e635d6ff9e9ce57f82",
measurementId: "G-BHPFZS22RQ"};

// This variable determines the final config used: prioritize the user's config if they've modified it,
// otherwise use the environment variable provided by the Canvas (__firebase_config).
const firebaseConfig = Object.keys(userProvidedConfig).length > 0 ? userProvidedConfig : 
                       JSON.parse(typeof __firebase_config !== 'undefined' ? __firebase_config : '{}');
                       
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : '';

const REPORTS_COLLECTION_NAME = 'reports';
const COLLECTION_PATH = `artifacts/${appId}/public/data/${REPORTS_COLLECTION_NAME}`;

// 🚨 2. GEMINI API KEY:
// IMPORTANT: The API key for Gemini is required for all AI steps (seeding and RAG).
const API_KEY = "AIzaSyAt4wkIhJcLyu725jzqKsPyEuv7UbfHQ1U"; 
const API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=" + API_KEY;


// --- VECTOR SEARCH UTILITY FUNCTIONS (Simulated In-Memory) ---
const tokenizeAndVectorize = (text) => {
    const tokens = text.toLowerCase().match(/\b\w+\b/g) || [];
    const vector = {};
    for (const token of tokens) {
        vector[token] = (vector[token] || 0) + 1;
    }
    return vector;
};

const cosineSimilarity = (vecA, vecB) => {
    if (!vecA || !vecB || typeof vecA !== 'object' || typeof vecB !== 'object') return 0;
    
    const keysA = Object.keys(vecA);
    const keysB = Object.keys(vecB);
    const intersection = keysA.filter(key => vecB.hasOwnProperty(key));

    let dotProduct = 0;
    for (const key of intersection) {
        dotProduct += vecA[key] * vecB[key];
    }

    let magnitudeA = 0;
    for (const key of keysA) {
        magnitudeA += vecA[key] ** 2;
    }

    let magnitudeB = 0;
    for (const key of keysB) {
        magnitudeB += vecB[key] ** 2;
    }

    magnitudeA = Math.sqrt(magnitudeA);
    magnitudeB = Math.sqrt(magnitudeB);

    if (magnitudeA === 0 || magnitudeB === 0) return 0;

    return dotProduct / (magnitudeA * magnitudeB);
};


// --- AI GENERATION UTILITY FUNCTION (FOR RAG) ---
async function fetchAndGenerateSingleReport(userQuery) {
    if (!API_KEY) {
        console.error("API Key missing, cannot fetch reports from the web.");
        return null;
    }
    
    const systemPrompt = "You are a professional educational data curator. Your task is to perform an exhaustive search of research published since 2015 and summarize ONE single, high-quality report relevant to the user's query, prioritizing sources from the top 100 globally ranked universities. **For the title, provide the exact, original title of the source document.** If a specific report or paper is found, include its URL in a new field. Return the result as a JSON object, strictly following the provided schema.";    
    const fullQuery = `Find and summarize one highly relevant, authoritative educational report since 2015 related to the topic: "${userQuery}".`;

    const payload = {
        contents: [{ parts: [{ text: fullQuery }] }],
        tools: [{ "google_search": {} }], 
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
                type: "OBJECT", 
                "properties": {
    "title": { "type": "STRING", "description": "The precise, original title of the published report." },
    "content": { "type": "STRING", "description": "A detailed summary of the report's key findings." },
    "keywords": {
        "type": "ARRAY",
        "items": { "type": "STRING" }
    },
    "category": { "type": "STRING", "description": "The general educational area this report covers." },
    "publisher": { "type": "STRING", "description": "The publisher or source of the report (e.g., Stanford University, UNESCO)." },
    "url": { "type": "STRING", "description": "The URL of the original source document." }
}
                // REMOVED propertyOrdering TO REDUCE COMPLEXITY
            }
        }
    };

    // This is the fixed 5-second wait, which should resolve the 429 error.
    const waitTime = 5000; // 5000 milliseconds = 5 seconds

    for (let i = 0; i < 3; i++) {
        try {
            const apiUrl = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=" + API_KEY;

            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                console.error(`Gemini API HTTP Error (Attempt ${i + 1}): Status ${response.status}`);
                if (i < 2) {
                    // ... inside the loop
await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000 + Math.random() * 100));
                    continue;
                }
                throw new Error(`HTTP error! Status: ${response.status}`);
            }

            const result = await response.json();
            const jsonText = result.candidates?.[0]?.content?.parts?.[0]?.text;
            
            if (jsonText) {
                try {
                    const report = JSON.parse(jsonText);
                    console.log("Successfully fetched and parsed single report from Gemini API.");
                    return report;
                } catch (e) {
                    console.error("Failed to parse JSON response during report generation. Gemini response was not valid JSON:", e);
                    return null; 
                }
            }
            return null;

        } catch (error) {
            console.error(`Attempt ${i + 1} failed during report generation (Network/Fetch):`, error);
        }
    }
    
    return null; 
}

// --- AI GENERATION UTILITY FUNCTION (FOR FINAL SUMMARY) ---
async function generateAISummary(reportContent, userQuery) {
    if (!API_KEY) {
        console.error("API Key missing, cannot generate summary.");
        return "Summary could not be generated due to missing API key.";
    }

    const maxContentLength = 25000;
    const truncatedContent = reportContent.length > maxContentLength 
        ? reportContent.substring(0, maxContentLength) + "..." 
        : reportContent;

    const prompt = `You are a professional research assistant. Based on the following report content, please provide a concise and clear summary that directly answers the user's query. It should be extremely descriptive.
    
    User Query: ${userQuery}
    
    Report Content:
    ${truncatedContent}
    
    Summary:`;

    const payload = {
        contents: [{ parts: [{ text: prompt }] }],
    };
    
    // Implement retry logic for transient errors like 503
    for (let i = 0; i < 5; i++) { // Increase the number of attempts
        try {
            const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=" + API_KEY, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (response.status === 503 || response.status === 429) {
                const retryAfter = response.headers.get('Retry-After');
                const delay = retryAfter ? parseInt(retryAfter) * 1000 : Math.pow(2, i) * 1000 + Math.random() * 1000;
                console.warn(`Attempt ${i + 1} failed with status ${response.status}. Retrying in ${delay / 1000} seconds...`);
                await new Promise(resolve => setTimeout(resolve, delay));
                continue; // Continue to the next loop iteration
            }

            if (!response.ok) {
                throw new Error(`HTTP error! Status: ${response.status}`);
            }

            const result = await response.json();
            return result.candidates?.[0]?.content?.parts?.[0]?.text || "No summary could be generated.";

        } catch (error) {
            console.error(`Attempt ${i + 1} failed during AI summary generation:`, error);
        }
    }

    // If all attempts fail
    return "Failed to generate summary after multiple attempts.";
}



// --- APP COMPONENT ---
const App = () => {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState([]);
    const [loading, setLoading] = useState(false);
    
    // Firebase State
    const [db, setDb] = useState(null);
    const [auth, setAuth] = useState(null);
    const [userId, setUserId] = useState(null);
    const [isDbReady, setIsDbReady] = useState(false);
    const [isSeedingFromWeb, setIsSeedingFromWeb] = useState(false); 
    const [apiKeyProvided, setApiKeyProvided] = useState(false); 

    // --- FIREBASE INITIALIZATION AND AUTHENTICATION (Phase 1) ---
    useEffect(() => {
        if (!API_KEY) {
            setApiKeyProvided(false);
        } else {
            setApiKeyProvided(true);
        }

        if (Object.keys(firebaseConfig).length === 0) {
            notification.error({
                message: 'Configuration Error',
                description: 'Firebase configuration is missing.',
            });
            return;
        }

        try {
            const app = initializeApp(firebaseConfig);
            const authInstance = getAuth(app);
            const dbInstance = getFirestore(app);
            
            setAuth(authInstance);
            setDb(dbInstance);

            const unsubscribe = onAuthStateChanged(authInstance, async (user) => {
                if (!user) {
                    try {
                        if (initialAuthToken) {
                            await signInWithCustomToken(authInstance, initialAuthToken)
                        } else {
                            const userCredential = await signInAnonymously(authInstance);
                            setUserId(userCredential.user.uid);
                        }
                    } catch (e) {
                        console.error("Authentication failed:", e);
                    }
                } else {
                    setUserId(user.uid);
                }
                
                setIsDbReady(true);
            });

            return () => unsubscribe(); // Cleanup auth listener
        } catch (error) {
            console.error("Firebase initialization failed:", error);
            notification.error({
                message: 'Startup Error',
                description: 'Failed to initialize Firebase services.',
            });
        }
    }, []); 

    // --- DATABASE READY CHECK AND REPAIR (Phase 2) ---
    // Note: Initial BULK seeding is now REMOVED. Database grows only on-demand during search.
    useEffect(() => {
        if (isDbReady && db) {
             seedDatabase(db);
        }
    }, [isDbReady, db]); 

    // --- DATABASE REPAIR LOGIC (Kept for cleanup of previous version's partial seeds) ---
    const seedDatabase = async (dbInstance) => {
        if (!dbInstance) return;

        const reportsCollectionRef = collection(dbInstance, COLLECTION_PATH);
        
        try {
            const querySnapshot = await getDocs(reportsCollectionRef);

            // --- DATA REPAIR LOGIC (Only runs if a previous version left incomplete data) ---
            let needsVectorUpdate = false;
            const firstDoc = querySnapshot.docs[0];
            if (firstDoc && !firstDoc.data().vector) {
                needsVectorUpdate = true;
            }

            if (needsVectorUpdate) {
                console.log("Existing documents are missing the 'vector' field. Running repair/update process.");
                setIsSeedingFromWeb(true); 
                
                for (const docSnapshot of querySnapshot.docs) {
                    const report = docSnapshot.data();
                    
                    if (!report.vector) {
                        const vectorText = `${report.title} ${report.content} ${report.category || ''} ${report.keywords.join(" ")}`;
                        const reportVector = tokenizeAndVectorize(vectorText);
                        
                        const docRef = doc(dbInstance, COLLECTION_PATH, docSnapshot.id);
                        
                        try {
                            await updateDoc(docRef, { vector: reportVector });
                            console.log(`Repaired vector for document: ${docSnapshot.id}`);
                        } catch(e) {
                            console.error(`Failed to update document vector. Check security rules!`, e);
                            notification.error({
                                message: 'Firestore Update Error',
                                description: `Failed to repair document. Check security rules and network. Error: ${e.message}`,
                            });
                            break;
                        }
                    }
                }
                notification.success({
                    message: 'Database Repaired',
                    description: 'Missing vector data was calculated and added to existing documents.',
                });
                console.log("Database vector repair complete.");
                setIsSeedingFromWeb(false);
            } else {
                console.log("Database initialized. Ready for on-demand search and seeding.");
            }
        } catch (error) {
            console.error("Error accessing database during repair check:", error);
            notification.error({
                message: 'Database Access Error',
                description: `Failed to check database status: ${error.message}`,
            });
        }
    };
    
    // --- CORE SEARCH FUNCTION (ON-DEMAND RAG) ---
    const handleSearch = async (userQuery) => {
        if (!isDbReady || isSeedingFromWeb) {
            notification.warning({
                message: 'System Not Ready',
                description: 'Database is still initializing or repairing data. Please wait.',
            });
            return;
        }
        if (!apiKeyProvided) {
            notification.error({ message: 'API Key Missing', description: 'Cannot perform RAG search without a Gemini API Key.' });
            return;
        }

        if (!userQuery.trim()) {
            notification.warning({ message: 'Empty Query', description: 'Please enter a topic to search.' });
            return;
        }

        setLoading(true);
        setResults([]);
        
        try {
            const reportsCollectionRef = collection(db, COLLECTION_PATH);
            
            // 1. GENERATE QUERY VECTOR
            const queryVector = tokenizeAndVectorize(userQuery);

            let retrievedReports = [];
            
            // --- LOOP: FIRST ATTEMPT AGAINST DATABASE ---
            const initialQuerySnapshot = await getDocs(reportsCollectionRef);

            // 2. VECTOR SEARCH (Cosine Similarity Ranking on existing data)
            initialQuerySnapshot.forEach(doc => {
                const report = doc.data();
                const docVector = report.vector;
                
                if (docVector && typeof docVector === 'object') {
                    const similarityScore = cosineSimilarity(queryVector, docVector);
                    if (similarityScore > 0.275) { 
                        retrievedReports.push({ 
                            id: doc.id, 
                            ...report, 
                            score: similarityScore
                        });
                    }
                }
            });

            // 3. ON-DEMAND SEEDING TRIGGER
            if (retrievedReports.length === 0) {
                notification.info({ 
                    message: 'Expanding Knowledge Base', 
                    description: `No relevant report found in the database. Searching web and adding a new report for "${userQuery}" now...` 
                });
                setIsSeedingFromWeb(true);
                
                // --- THIS CALL LIKELY CAUSES THE 400 ERROR ---
                const newReportData = await fetchAndGenerateSingleReport(userQuery);
                
                if (newReportData) {
                    // 4. ADD NEW REPORT TO FIRESTORE
                    const vectorText = `${newReportData.title} ${newReportData.content} ${newReportData.category || ''} ${newReportData.keywords.join(" ")}`;
                    const reportVector = tokenizeAndVectorize(vectorText);
                    
                    try {
                        const docRef = await addDoc(reportsCollectionRef, { ...newReportData, vector: reportVector });
                        console.log(`Successfully seeded new report: ${docRef.id}`);

                        // Immediately use the newly added report for RAG
                        retrievedReports.push({ 
                            id: docRef.id, 
                            ...newReportData, 
                            vector: reportVector, 
                            score: cosineSimilarity(queryVector, reportVector) 
                        });
                    } catch (e) {
                         console.error(`Failed to add document to Firestore during on-demand seeding. Check security rules!`, e);
                         notification.error({
                            message: 'Firestore Write Error',
                            description: `Failed to write document. Check security rules and network. Error: ${e.message}`,
                        });
                    }
                } else {
                     notification.warning({ message: 'Search Failed', description: 'Could not find or generate a relevant report from the web.' });
                }
                
                setIsSeedingFromWeb(false);
            }
            
            // Final check after potential seeding
            if (retrievedReports.length === 0) {
                setResults([]);
                notification.info({ message: 'No Data Found', description: 'The search returned zero relevant reports from the database or the web.' });
                return;
            }

            // 5. RETRIEVAL (Rank and limit)
            const finalRetrievedReports = retrievedReports
                .sort((a, b) => b.score - a.score) 
                .slice(0, 3); 

            // 6. RAG GENERATION (Call the AI for the retrieved/newly added reports)
            const generatedResults = await Promise.all(
                finalRetrievedReports.map(async (report) => ({ 
                    ...report,
                    summary: await generateAISummary(report.content, userQuery),
                }))
            );
            
            setResults(generatedResults);

        } catch (error) {
            console.error("Search failed:", error);
            notification.error({ message: 'Search Error', description: `Failed to execute the search operation: ${error.message}` });
        } finally {
            setLoading(false);
        }
    };


    return (
        <Layout style={{ maxHeight: '100vh', backgroundColor: '#f5f5f5' }}>
            <Content style={{ padding: '50px 20px'}}>
                <div style={{ maxWidth: '1920px', margin: '0 auto' }}>
                <Card 
                    title={<Title level={2} style={{ margin: 0, textAlign: 'center', marginTop: '20px' }}>Educational Reports Research</Title>}
                    bordered={false}
                    style={{ 
                        borderRadius: 12, 
                        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.05)',
                        marginTop: '-20px',
                        boxShadow: 'rgba(255, 255, 255, 0.1) 0px 1px 1px 0px inset, rgba(50, 50, 93, 0.25) 0px 50px 100px -20px, rgba(0, 0, 0, 0.3) 0px 30px 60px -30px',
                    }}
                >
                    <br/><Paragraph style={{ textAlign: 'center', marginBottom: 24, color: '#8c8c8c' }}>
                        Search Authoritative Educational Reports across the Internet to get valid Research
                    </Paragraph>
                    
                    <Input.Search
                        placeholder="Ask a question, e.g., 'What is the impact of gamification on adult learning outcomes?'"
                        allowClear
                        enterButton={<Button type="primary" icon={<SearchOutlined />}>Search</Button>}
                        size="large"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onSearch={handleSearch}
                        loading={loading}
                        disabled={loading || !isDbReady || isSeedingFromWeb || !apiKeyProvided}
                        style={{ marginBottom: '50px', maxWidth: '800px', margin: '0 auto', display: 'block', marginTop: '50px'  }}
                    />
                    
                    {!apiKeyProvided && (
                        <div style={{ textAlign: 'center', padding: '20px 0', backgroundColor: '#fffbe6', border: '1px solid #ffe58f', borderRadius: 8, marginBottom: '0px' }}>
                            <WarningOutlined style={{ color: '#faad14', marginRight: 8 }} />
                            <Paragraph strong style={{ display: 'inline', color: '#faad14' }}>
                                **CRITICAL: Gemini API Key is missing!** Seeding and RAG will fail. Please update the `API_KEY` variable in `App.jsx`.
                            </Paragraph>
                        </div>
                    )}

                    {(!isDbReady || isSeedingFromWeb) && apiKeyProvided && (
                        <div style={{ textAlign: 'center', padding: '30px 0' }}>
                            <Spin indicator={<LoadingOutlined style={{ fontSize: 24 }} spin />} />
                            <Paragraph style={{ marginTop: 15 }}>
                                {isSeedingFromWeb 
                                    ? "Expanding Knowledge Base: Searching web for a new report..."
                                    : "Connecting to Knowledge Base and Retrieving Report..."
                                }
                            </Paragraph>
                        </div>
                    )}
                    
                    {isDbReady && apiKeyProvided && !isSeedingFromWeb && (loading || results.length > 0) && (
                        <div style={{ minHeight: '150px', width: '100%' }}>
                            {loading ? (
                                <div style={{ textAlign: 'center', padding: '5px 0' }}>
                                    <Spin indicator={<LoadingOutlined style={{ fontSize: 24 }} spin />} />
                                    <Paragraph style={{ marginTop: 15 }}>Retrieving data and generating AI-grounded summary...</Paragraph>
                                </div>
                            ) : (
                                <Space direction="vertical" size="middle">
                                    <Title level={4}>Found {results.length} Relevant Reports (Ranked by Similarity Score):</Title>
                                    {results.map((report) => (
                                        <Card 
                                            key={report.id} 
                                            style={{ borderRadius: 8, borderLeft: '3px solid #1890ff' }}
                                            extra={<>
                                                <Tag color="blue">Score: {report.score.toFixed(3)}</Tag>
                                                <Tag color="geekblue">Category: {report.category || 'N/A'}</Tag>
                                                <Tag color="purple">Publisher: {report.publisher || 'N/A'}</Tag>
                                            </>}
                                        >
                                            <Title level={5}>{report.title}</Title>
                                            <Paragraph strong style={{ color: '#1890ff' }}>AI-Grounded Summary:</Paragraph>
                                            <Paragraph>{report.summary}</Paragraph>
                                            <a style={{fontSize: '12px'}} href={report.url || ''} target='_blank'>{report.url || ''}</a>
                                        </Card>
                                    ))}
                                    <Paragraph type="secondary" style={{ textAlign: 'center', paddingTop: '10px' }}>
                                        Summaries are generated based on the query, finding answers in the retrieved reports.
                                    </Paragraph>
                                </Space>
                            )}
                        </div>
                    )}
                    
                    {isDbReady && apiKeyProvided && !isSeedingFromWeb && !loading && results.length === 0 && (
                        <div style={{ textAlign: 'center', padding: '30px 0', border: '1px dashed #d9d9d9', borderRadius: 8, marginTop: '50px' }}>
                            <Paragraph style={{ color: '#8c8c8c' }}>
                                Enter a query to search the dynamic educational database. If no relevant reports are found, a relevant report will be fetched from the web!
                            </Paragraph>
                        </div>
                    )}
                </Card>
              </div>
              
            </Content>
            <Footer style={{ textAlign: 'center', color: '#8c8c8c', marginTop: '0px'}}>
                @Educational Reports Research
            </Footer>
        </Layout>
    );
};

export default App;
