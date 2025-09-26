import React, { useState, useEffect } from 'react';
import { Layout, Input, Button, Card, Spin, Space, Typography, notification } from 'antd';
import { SearchOutlined, LoadingOutlined } from '@ant-design/icons';

// NOTE: This single file acts as the complete, self-contained React application.
// Ant Design components (Layout, Input, Card, etc.) are assumed to be available
// in this environment.

const { Header, Content, Footer } = Layout;
const { Title, Paragraph } = Typography;

// --- Mock Data Structure Placeholder ---
// This is the shape of the data we will eventually pull from the Firestore database
// and use to generate the AI summary.
const mockSearchResults = [
    { id: '1', title: 'Phonics-Based Reading Programs: A 5-Year Review', content: 'Detailed analysis text...', keywords: ['phonics', 'literacy'] },
    { id: '2', title: 'Hybrid Learning Models in K-12: Success Factors', content: 'Comprehensive report text...', keywords: ['hybrid learning', 'technology'] },
];

const API_KEY = ""; // Placeholder for Gemini API key
const API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=" + API_KEY;

// --- AI GENERATION UTILITY FUNCTION (Simulated) ---
// This function will be the heart of our RAG process.
async function generateAISummary(reportContent, userQuery) {
    // In a real RAG system, 'reportContent' would be small, relevant text chunks.
    const systemPrompt = "You are a world-class AI assistant for educational research. Based ONLY on the provided report content, answer the user's question with a concise, factual summary. If the content is irrelevant, state so.";
    const fullQuery = `User Question: "${userQuery}".\n\nReport Content to base the answer on: "${reportContent}"`;

    const payload = {
        contents: [{ parts: [{ text: fullQuery }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
    };

    // Simulate API call for demonstration purposes before integration
    console.log("Simulating AI Summary Generation...");
    
    // In a real implementation, you would use fetch and exponential backoff here.
    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw new Error('AI API call failed.');
        }

        const result = await response.json();
        const textResult = result.candidates?.[0]?.content?.parts?.[0]?.text;
        return textResult || "Could not generate a relevant summary based on the report data.";

    } catch (error) {
        console.error("Error during API call:", error);
        notification.error({
            message: 'AI Service Error',
            description: 'Failed to communicate with the summarization engine.',
        });
        return "Failed to generate AI-grounded answer.";
    }
}


const App = () => {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState([]);
    const [loading, setLoading] = useState(false);
    const [isDbReady, setIsDbReady] = useState(false); // State to track Firebase initialization

    // Placeholder for actual Firebase logic (moved to a useEffect hook later)
    useEffect(() => {
        // Here, we would initialize Firebase and authenticate the user.
        // For now, we'll simulate readiness after a brief delay.
        const timer = setTimeout(() => {
            setIsDbReady(true);
            notification.success({
                message: 'Platform Ready',
                description: 'The search interface is active and awaiting your query.',
            });
        }, 1500);
        
        return () => clearTimeout(timer);
    }, []);


    // --- Core Search Function (Placeholder for Firestore + RAG) ---
    const handleSearch = async (userQuery) => {
        if (!isDbReady) {
            notification.warning({
                message: 'System Not Ready',
                description: 'Database connection is still initializing. Please wait a moment.',
            });
            return;
        }

        if (!userQuery.trim()) {
            notification.warning({ message: 'Empty Query', description: 'Please enter a topic to search.' });
            return;
        }

        setLoading(true);
        setResults([]);
        
        try {
            // 1. DATABASE RETRIEVAL (In the real app, we'd query Firestore here)
            // For now, we'll just mock the retrieval based on simple keyword matching.
            const retrievedReports = mockSearchResults.filter(
                report => report.keywords.some(k => userQuery.toLowerCase().includes(k)) || 
                          report.title.toLowerCase().includes(userQuery.toLowerCase())
            );

            if (retrievedReports.length === 0) {
                setResults([]);
                notification.info({ message: 'No Data Found', description: 'The search returned no relevant reports from the simulated database.' });
                return;
            }

            // 2. RAG GENERATION (Call the AI for each relevant report)
            const generatedResults = await Promise.all(
                retrievedReports.map(async (report) => ({
                    ...report,
                    summary: await generateAISummary(report.content, userQuery),
                }))
            );
            
            setResults(generatedResults);

        } catch (error) {
            console.error("Search failed:", error);
            notification.error({ message: 'Search Error', description: 'Failed to execute the search operation.' });
        } finally {
            setLoading(false);
        }
    };


    return (
        <Layout style={{ minHeight: '100vh', backgroundColor: '#f5f5f5' }}>
            <Content style={{ padding: '50px 24px', maxWidth: '800px', margin: '0 auto', width: '100%' }}>
                <Card 
                    title={<Title level={2} style={{ margin: 0, textAlign: 'center' }}>Educational RAG Platform</Title>}
                    bordered={false}
                    style={{ borderRadius: 12, boxShadow: '0 4px 12px rgba(0, 0, 0, 0.05)' }}
                >
                    <Paragraph style={{ textAlign: 'center', marginBottom: 24, color: '#8c8c8c' }}>
                        Search a curated database of reports to get AI-grounded answers.
                    </Paragraph>
                    
                    <Input.Search
                        placeholder="Ask a question, e.g., 'What is the impact of phonics programs on K-12 students?'"
                        allowClear
                        enterButton={<Button type="primary" icon={<SearchOutlined />}>Search</Button>}
                        size="large"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onSearch={handleSearch}
                        loading={loading}
                        disabled={loading || !isDbReady}
                        style={{ marginBottom: 24 }}
                    />

                    {loading && (
                        <div style={{ textAlign: 'center', padding: '30px 0' }}>
                            <Spin indicator={<LoadingOutlined style={{ fontSize: 24 }} spin />} />
                            <Paragraph style={{ marginTop: 15 }}>Retrieving data and generating AI-grounded summary...</Paragraph>
                        </div>
                    )}

                    {!loading && results.length > 0 && (
                        <Space direction="vertical" style={{ width: '100%' }} size="middle">
                            <Title level={4}>Found {results.length} Relevant Reports:</Title>
                            {results.map((report) => (
                                <Card key={report.id} style={{ borderRadius: 8, borderLeft: '3px solid #1890ff' }}>
                                    <Title level={5}>{report.title}</Title>
                                    <Paragraph strong style={{ color: '#1890ff' }}>AI-Grounded Answer:</Paragraph>
                                    <Paragraph>{report.summary}</Paragraph>
                                </Card>
                            ))}
                        </Space>
                    )}
                    
                    {!loading && results.length === 0 && query.trim() && (
                        <div style={{ textAlign: 'center', padding: '30px 0', border: '1px dashed #d9d9d9', borderRadius: 8 }}>
                            <Paragraph style={{ color: '#8c8c8c' }}>No results found or waiting for first search.</Paragraph>
                        </div>
                    )}
                </Card>
            </Content>
            <Footer style={{ textAlign: 'center', color: '#8c8c8c' }}>
                Educational RAG Platform powered by Gemini API and Ant Design
            </Footer>
        </Layout>
    );
};

export default App;
